package com.trippilot.notification.application

import com.trippilot.notification.domain.PushReceiptPort
import com.trippilot.notification.domain.PushTicket
import com.trippilot.notification.domain.PushTicketRepository
import com.trippilot.notification.domain.PushTokenRepository
import com.trippilot.notification.domain.ReceiptStatus
import com.trippilot.notification.domain.TicketReceipt
import org.slf4j.LoggerFactory
import org.springframework.beans.factory.annotation.Value
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty
import org.springframework.scheduling.annotation.Scheduled
import org.springframework.stereotype.Component
import java.time.Clock
import java.time.Duration
import java.time.Instant

/**
 * 영수증 한 건을 어떻게 다룰지 — 순수 함수로 떼어 [PushReceiptPoller] 의 부수효과와 판정을 가른다(속성 테스트 대상).
 *
 * `SENT` 는 **Expo 가 접수했다**는 뜻이고, APNs·FCM 단계의 실패는 영수증으로만 안다. 오류 코드는 **토큰의 문제인지 프로젝트(우리)의 문제인지**가 갈려야
 * 한다 — 프로젝트 자격이 틀린 것(`InvalidCredentials`·`MismatchSenderId`)을 토큰 탓으로 읽어 무효화하면, 살아 있는 기기를 전부 죽이고도
 * 원인(.p8 누락)은 그대로 남는다.
 */
internal sealed interface ReceiptDecision {
    /** 영수증 ok. */
    data object Ok : ReceiptDecision

    /** 오류 영수증. [kind] 가 후속 처리를 정한다. */
    data class Error(val code: String, val kind: ErrorKind) : ReceiptDecision

    /** 24시간이 지나도 영수증이 없다 — 끝내 모른다. */
    data object Expired : ReceiptDecision

    /** 영수증이 아직 없다(15분은 지났지만 만들어지기 전일 수 있다) — 다음 회차에 다시 묻는다. */
    data object Keep : ReceiptDecision
}

internal enum class ErrorKind {
    /** 그 기기가 이 토큰을 더 안 쓴다 — 토큰을 무효화한다(INV-U6-07). */
    DEAD_TOKEN,

    /** 프로젝트 자격·발신자 오류 — **토큰이 아니라 우리 설정이다.** 무효화하지 않고 경보한다. */
    PROJECT_CREDENTIALS,

    /** 발송 속도 한도 — 기록만. */
    RATE_LIMIT,

    /** 메시지가 너무 크다 — 기록만(문구가 비정상이다). */
    TOO_BIG,

    /** 그 밖·코드 없음 — 기록하고 지켜본다. */
    OTHER,
}

internal fun decideReceipt(receipt: TicketReceipt?, age: Duration, expiry: Duration): ReceiptDecision = when {
    receipt == null -> if (age >= expiry) ReceiptDecision.Expired else ReceiptDecision.Keep
    receipt.ok -> ReceiptDecision.Ok
    else -> {
        val code = receipt.error?.takeIf { it.isNotBlank() } ?: "UNKNOWN"
        ReceiptDecision.Error(
            code,
            when (code) {
                "DeviceNotRegistered" -> ErrorKind.DEAD_TOKEN
                "InvalidCredentials", "MismatchSenderId" -> ErrorKind.PROJECT_CREDENTIALS
                "MessageRateExceeded" -> ErrorKind.RATE_LIMIT
                "MessageTooBig" -> ErrorKind.TOO_BIG
                else -> ErrorKind.OTHER
            },
        )
    }
}

/**
 * 푸시 영수증 폴러(TRIP-1707) — 발송 15분 뒤부터 티켓 id 로 영수증을 조회해 **도착 실패를 서버가 알게** 한다.
 *
 * - **expo 모드에서만 뜬다**(CI 기본 컨텍스트엔 없다 — 외부 호출 0). `PUSH_MODE=off` 가 발송과 폴러를 함께 끄는 응급 차단이다.
 * - HTTP 는 **트랜잭션 밖**이다(이 폴러는 `@Transactional` 이 아니다). 판정은 티켓마다 조건부 UPDATE 한 번 — 다중 인스턴스가 같은 영수증을
 *   받아도 판정은 하나만 성공하고, **부수효과(토큰 무효화·로그·지표)는 성공한 쪽만** 낸다. 잠금이 필요 없다.
 * - 조회 실패(한도·자격·네트워크)는 **상태를 바꾸지 않고** 다음 회차로 넘긴다 — 자격 계열 HTTP 오류는 `push.alert` ERROR 로 올린다.
 * - 알림함 행(`push_sent_at`·`push_failed_reason`)은 건드리지 않는다 — 발송량 상한과 Plan-B 묶음 판정이 읽는 값이다.
 */
@Component
@ConditionalOnProperty(name = ["trippilot.push.mode"], havingValue = "expo")
class PushReceiptPoller(
    private val tickets: PushTicketRepository,
    private val receipts: PushReceiptPort,
    private val tokens: PushTokenRepository,
    private val metrics: NotificationMetrics,
    private val clock: Clock,
    /** 발송 뒤 이만큼은 기다린 티켓만 묻는다 — Expo 는 영수증을 약 15분 뒤부터 만든다. */
    @Value("\${trippilot.notification.receipt-min-age-ms:900000}") private val minAgeMs: Long,
) {
    @Scheduled(
        fixedDelayString = "\${trippilot.notification.receipt-poll-ms:300000}",
        initialDelayString = "\${trippilot.notification.receipt-poll-initial-delay-ms:60000}",
    )
    fun poll() {
        val now = clock.instant()
        val due = tickets.findDue(now.minusMillis(minAgeMs), BATCH * MAX_REQUESTS_PER_CYCLE)
        if (due.isEmpty()) return

        val tally = Tally()
        for (chunk in due.chunked(BATCH)) {
            val found = runCatching { receipts.fetch(chunk.map { it.ticketId }) }
                .getOrElse { e ->
                    logFetchFailure(e)
                    return finish(now, tally)   // 상태를 안 바꾸고 다음 회차로 — 한도·자격 오류에 계속 두드리지 않는다
                }
            chunk.forEach { ticket -> runCatching { handle(ticket, found[ticket.ticketId], now, tally) }
                .onFailure { log.warn("푸시 영수증 판정 중 오류 — 다음 회차에 다시 합니다. ticketId={}", ticket.ticketId, it) } }
        }
        finish(now, tally)
    }

    private fun handle(ticket: PushTicket, receipt: TicketReceipt?, now: Instant, tally: Tally) {
        val age = Duration.between(ticket.sentAt, now)
        when (val decision = decideReceipt(receipt, age, EXPIRY)) {
            ReceiptDecision.Keep -> Unit
            ReceiptDecision.Ok -> if (tickets.settle(ticket.ticketId, ReceiptStatus.OK, null, now)) {
                tally.ok++
                metrics.pushReceipt(ReceiptStatus.OK.name, null, ticket.platform.name)
            }
            ReceiptDecision.Expired -> if (tickets.settle(ticket.ticketId, ReceiptStatus.EXPIRED, null, now)) {
                tally.expired++
                metrics.pushReceipt(ReceiptStatus.EXPIRED.name, null, ticket.platform.name)
            }
            is ReceiptDecision.Error -> if (tickets.settle(ticket.ticketId, ReceiptStatus.ERROR, decision.code, now)) {
                tally.error++
                metrics.pushReceipt(ReceiptStatus.ERROR.name, decision.code, ticket.platform.name)
                onError(ticket, decision, age, now)
            }
        }
    }

    /** 오류를 **판정한 쪽만** 부른다 — 부수효과가 중복되지 않는다. 토큰·원문 message 는 로그에 싣지 않는다. */
    private fun onError(ticket: PushTicket, decision: ReceiptDecision.Error, age: Duration, now: Instant) {
        when (decision.kind) {
            ErrorKind.DEAD_TOKEN -> {
                // 그 발송 뒤에 다시 보인 토큰은 남긴다 — 영수증은 15분 이상 뒤에 오고 앱이 그 사이 재등록했을 수 있다.
                val invalidated = tokens.invalidateIfNotSeenSince(ticket.token, ticket.sentAt, now)
                log.info(
                    "push.receipt outcome=ERROR reason={} platform={} ageMin={} invalidated={}",
                    decision.code, ticket.platform, age.toMinutes(), invalidated,
                )
            }
            // 토큰이 아니라 **우리 프로젝트 설정**이 틀렸다(.p8·FCM 키) — 무효화하면 살아 있는 기기를 죽이고 원인은 그대로다. 경보한다.
            ErrorKind.PROJECT_CREDENTIALS -> log.error(
                "push.alert stage=receipt reason={} platform={} ageMin={}",
                decision.code, ticket.platform, age.toMinutes(),
            )
            ErrorKind.RATE_LIMIT, ErrorKind.TOO_BIG, ErrorKind.OTHER -> log.warn(
                "push.receipt outcome=ERROR reason={} platform={} ageMin={}",
                decision.code, ticket.platform, age.toMinutes(),
            )
        }
    }

    private fun logFetchFailure(e: Throwable) {
        val credentialsFailure = e is org.springframework.web.client.HttpClientErrorException &&
            (e.statusCode.value() == 401 || e.statusCode.value() == 403)
        if (credentialsFailure) {
            // 영수증 조회가 자격으로 거절됐다 — 발송도 같은 사유로 실패하고 있을 가능성이 크다. 경보 접두로 올린다.
            log.error("push.alert stage=receipt reason=HTTP_{} — 영수증 조회가 거절됐습니다(PUSH_EXPO_ACCESS_TOKEN 확인)", (e as org.springframework.web.client.HttpClientErrorException).statusCode.value())
        } else {
            log.warn("푸시 영수증 조회에 실패했습니다 — 상태를 바꾸지 않고 다음 회차에 다시 합니다. 원인={}", e.toString())
        }
    }

    private fun finish(now: Instant, tally: Tally) {
        val purged = runCatching { tickets.purgeSettledBefore(now.minus(RETENTION)) }.getOrDefault(0)
        val pending = runCatching { tickets.countPending() }.getOrDefault(-1L)
        if (tally.total() > 0 || purged > 0) {
            log.info(
                "push.receipt.poll ok={} error={} expired={} pending={} purged={}",
                tally.ok, tally.error, tally.expired, pending, purged,
            )
        }
    }

    private class Tally {
        var ok = 0
        var error = 0
        var expired = 0
        fun total() = ok + error + expired
    }

    private companion object {
        private val log = LoggerFactory.getLogger(PushReceiptPoller::class.java)

        /** `getReceipts` 한 요청에 담는 티켓 수 — Expo 는 요청당 최대 100건(지식 기반)이라 안전값으로 맞춘다. */
        private const val BATCH = 100

        /** 한 회차 최대 요청 수 — 폴러가 한 번에 오래 돌지 않게. 남은 것은 다음 회차(5분 뒤)에 묻는다. */
        private const val MAX_REQUESTS_PER_CYCLE = 10

        /** 영수증은 24시간 보관된다 — 그 뒤에도 없으면 끝내 모른다. */
        private val EXPIRY: Duration = Duration.ofHours(24)

        /** 판정이 끝난 기록의 보존 기간. */
        private val RETENTION: Duration = Duration.ofDays(7)
    }
}
