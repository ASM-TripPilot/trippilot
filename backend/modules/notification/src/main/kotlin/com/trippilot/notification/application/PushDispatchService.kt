package com.trippilot.notification.application

import com.trippilot.notification.domain.Notification
import com.trippilot.notification.domain.NotificationRepository
import com.trippilot.notification.domain.PushMessage
import com.trippilot.notification.domain.PushPort
import com.trippilot.notification.domain.PushRateLimited
import com.trippilot.notification.domain.PushStatus
import com.trippilot.notification.domain.PushTicket
import com.trippilot.notification.domain.PushTicketRepository
import com.trippilot.notification.domain.PushToken
import com.trippilot.notification.domain.PushTokenRepository
import org.slf4j.LoggerFactory
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import org.springframework.web.client.HttpClientErrorException
import java.time.Clock
import java.time.temporal.ChronoUnit
import java.util.UUID

/** [PushDispatchService.dispatch] 의 결과 — 왜 안 갔는지가 로그·테스트에서 구분돼야 한다. */
enum class PushOutcome {
    /** 하나 이상의 기기에 갔다. */
    SENT,

    /** 사용자가 이 종류의 푸시를 껐다. 인앱함에는 남아 있다(BR-U6-36). */
    MUTED,

    /** 쏠 기기가 없다 — 토큰 미등록이거나 OS 권한이 없다. */
    NO_DEVICE,

    /** 전부 실패했다. 인앱함에는 이미 있으므로 **전달 실패로 보지 않는다**(BR-U6-38). */
    FAILED,

    /**
     * 계정 발송량 소프트 상한을 넘겼다(COST-U6-01). **버린 것이 아니다** — 인앱함 행은 그대로 남고
     * catch-up 으로 전달된다(COST-U6-02 · INV-U6-02).
     */
    RATE_LIMITED,
}

/**
 * 알림 한 건을 **푸시 채널로** 내보낸다(U6 정본 §2.2 채널 판정 진리표).
 *
 * ## 인앱함 적재가 먼저다
 *
 * 이 서비스는 **적재가 끝난 뒤에** 불린다(INV-U6-02). 순서를 뒤집으면 푸시 실패가 적재를 막고,
 * 앱을 3일 뒤에 켠 사용자가 그 사이 알림을 통째로 잃는다 — catch-up "누락 0"의 근거는 푸시가
 * 아니라 알림함 행의 영속성이다.
 *
 * ## 실패를 삼키지 않는다
 *
 * 실패는 `push_failed_reason` 에 남긴다(BR-U6-38). 예외로 올리지 않는 이유는 전달 자체가 실패한
 * 것이 아니기 때문이다 — 사용자는 앱을 열면 그 알림을 본다. 다만 **조용히 지나가지도 않는다**:
 * 남기지 않으면 "왜 푸시가 안 왔나"에 답할 근거가 아무 데도 없다(INV-4).
 */
@Service
class PushDispatchService(
    private val tokens: PushTokenRepository,
    private val notifications: NotificationRepository,
    private val toggles: NotificationToggleService,
    private val push: PushPort,
    private val metrics: NotificationMetrics,
    private val limits: PushRateLimits,
    private val clock: Clock,
    // 접수된 티켓 id 를 남긴다 — 15분 뒤 영수증으로 도착 실패를 알기 위한 열쇠(TRIP-1707).
    private val tickets: PushTicketRepository,
) {
    /**
     * 발송 결과를 **한 자리에서** 센다(OBS-U6-02). 반환 지점이 다섯이라 각 자리에서 세면 하나를
     * 빠뜨려도 드러나지 않는다 — 빠뜨린 경로만 지표에서 조용히 사라진다.
     *
     * 같은 자리에서 **로그도 한 줄** 남긴다. 지표가 닿지 않는 곳에서는 `NO_DEVICE` 가 어디에도 흔적이
     * 없어, 푸시가 아무에게도 안 가도 밖에서는 보이지 않았다(10-30 운영: 계정 120 중 기기 2). 건수를 세려는
     * 줄이라 계정은 싣지 않는다 — 한 사람을 따라가는 건 알림함 행(`push_sent_at`·`push_failed_reason`)의 몫이다.
     */
    @Transactional
    fun dispatch(notification: Notification): PushOutcome {
        var reason: String? = null
        val outcome = doDispatch(notification) { reason = it }
        metrics.pushDispatched(outcome, reason, push.deliversExternally)
        log.info("push.dispatch outcome={} kind={} reason={} real={}", outcome, notification.kind, reason ?: "-", push.deliversExternally)
        return outcome
    }

    private inline fun doDispatch(notification: Notification, onReason: (String) -> Unit): PushOutcome {
        // 종류 토글 × OS 권한 = 채널 판정. `SYSTEM` 은 토글을 타지 않는다(INV-U6-03).
        if (!toggles.allowsPush(notification.accountId, notification.kind)) return PushOutcome.MUTED
        // 권한이 없는 기기는 쏴도 닿지 않는다 — 시도 자체를 하지 않는다(레이트리밋을 아낀다).
        val active = tokens.findActive(notification.accountId)
        val deliverable = active.filter { it.deliverable }
        if (deliverable.isEmpty()) {
            // "기기 없음"을 둘로 가른다 — 활성 토큰이 아예 없는가(앱이 등록을 못 했다: 빌드·APNs/FCM 설정), 토큰은 있는데
            // OS 알림 권한이 허용이 아닌가(사용자 설정·권한 요청 흐름). 운영 첫 집계(37건 전부 NO_DEVICE)는 로그만으로
            // 이 둘을 못 갈랐다 — 새 빌드가 나온 뒤에도 NO_DEVICE 가 남으면 어느 쪽인지가 곧 다음 할 일이다.
            onReason(if (active.isEmpty()) NotificationMetrics.REASON_NO_TOKEN else NotificationMetrics.REASON_NOT_GRANTED)
            return PushOutcome.NO_DEVICE
        }

        // 발송량 소프트 상한(COST-U6-01). **여기서 막는 이유**: Expo 무료 티어는 레이트리밋이
        // 계정 단위라, 버그 하나로 한 사용자가 폭주하면 그 계정 전체 발송이 죽는다.
        // 알림함 적재는 이미 끝났으므로(INV-U6-02) 생략해도 사용자가 알림을 잃지 않는다.
        //
        // **`SYSTEM` 도 예외가 아니다.** 토글은 면제하지만(INV-U6-03) 상한은 면제하지 않는다 —
        // 정본이 종류를 가르지 않고(COST-U6-01), 면제를 두면 폭주 경로가 바로 그리로 열린다.
        // 하루 50건을 시스템 공지로 채우는 상황 자체가 사고이므로 그때는 막히는 편이 맞다.
        // 막혀도 인앱함에는 남아 catch-up 으로 간다(COST-U6-02).
        if (overLimit(notification.accountId)) {
            metrics.suppressed(SuppressReason.RATE_LIMITED)
            log.info("발송량 상한을 넘겨 푸시를 생략합니다. accountId={}", notification.accountId)
            return PushOutcome.RATE_LIMITED
        }

        val now = clock.instant()
        // **유효 토큰 전부**에 보낸다(INV-U6-06 다기기) — 폰만 울리고 태블릿이 조용하면 그쪽을
        // 보고 있던 사용자는 놓친다.
        val receipts = runCatching { push.send(deliverable.map { it.token }, notification.toMessage()) }
            .getOrElse { e ->
                // 발송기 자체가 터진 경우(네트워크·설정·발송량 한도). 알림은 이미 알림함에 있다.
                record(notification.notificationId, sentAt = null, reason = "PUSH_ERROR: ${e.javaClass.simpleName}")
                // 발송량 한도만 지표의 레이트리밋 칸으로 센다(OBS-U6-02) — 네트워크·5xx 와 섞이면 COST-U6-04 의
                // 재평가 트리거가 지표에서 안 보인다. 처리(기록·결말)는 다른 발송기 예외와 같다.
                onReason(if (e is PushRateLimited) RATE_LIMITED_REASON else "PUSH_ERROR")
                log.warn("푸시 발송에 실패했습니다. notificationId={} 원인={}", notification.notificationId, e.toString())
                // 접수 요청 자체가 자격으로 거절됐다 — 영수증 단계와 같은 경보 접두로 한 건이어도 바로 올린다.
                if (e is HttpClientErrorException && (e.statusCode.value() == 401 || e.statusCode.value() == 403)) {
                    log.error("push.alert stage=ticket reason=HTTP_{} — 푸시 발송이 거절됐습니다(PUSH_EXPO_ACCESS_TOKEN 확인)", e.statusCode.value())
                }
                return PushOutcome.FAILED
            }

        // 프로젝트 자격 오류는 토큰 탓이 아니라 우리 설정(.p8·FCM 키)이다. 실패 3건/15분 경보를 기다리면 첫 아침 리마인드가 전부
        // 막힌 뒤에야 안다 — 영수증 단계와 같은 접두로 첫 한 건에 바로 올린다. 토큰은 싣지 않는다.
        receipts.firstOrNull { it.reason in PROJECT_CREDENTIAL_ERRORS }?.let { r ->
            log.error("push.alert stage=ticket reason={} platform={}", r.reason, deliverable.firstOrNull { it.token == r.token }?.platform)
        }

        receipts.filter { it.status == PushStatus.DEVICE_NOT_REGISTERED }.forEach {
            // INV-U6-07 — **즉시** 무효화한다. 다음 발송 때 다시 만나면 그때는 후보에도 없다.
            if (tokens.invalidate(it.token, now)) log.info("죽은 푸시 토큰을 무효화했습니다.")
        }

        recordTickets(notification, deliverable, receipts, now)

        val sent = receipts.count { it.status == PushStatus.SENT }
        return if (sent > 0) {
            record(notification.notificationId, sentAt = now, reason = null)
            PushOutcome.SENT
        } else {
            // 전부 실패했어도 인앱함 행은 남아 있다 — 사용자는 앱을 열면 본다(BR-U6-38).
            val failure = reasonOf(receipts)
            record(notification.notificationId, sentAt = null, reason = failure)
            onReason(failure)
            PushOutcome.FAILED
        }
    }

    /**
     * 접수된 티켓(`SENT` + 티켓 id)을 남긴다 — 영수증 조회의 열쇠다. **절대 발송을 깨지 않는다**: 이 호출은 발송 트랜잭션 안이라
     * 여기서 터지면 발화가 롤백돼 다음 폴링이 같은 예약을 다시 집는다. 그래서 (1) 저장소는 `ON CONFLICT DO NOTHING` 이고 토큰에
     * FK 가 없으며, (2) 컬럼 폭을 넘는 값은 여기서 걸러 INSERT 가 터질 일을 없애고, (3) 저장소가 INSERT 를 세이브포인트 안에서 써서 DB 오류도 그 문 하나로 끊고(Postgres 는 오류 난 문이 바깥 트랜잭션을 25P02 로 죽인다),
     * (4) 그래도 예외가 나면 삼키고 한 줄 남긴다.
     * 티켓을 못 남기면 그 발송은 영수증 확인 대상에서 빠질 뿐 — 알림은 이미 알림함에 있고 푸시는 나갔다.
     */
    private fun recordTickets(
        notification: Notification,
        sentTo: List<com.trippilot.notification.domain.PushToken>,
        receipts: List<com.trippilot.notification.domain.PushReceipt>,
        now: java.time.Instant,
    ) {
        val platformByToken = sentTo.associate { it.token to it.platform }
        val rows = receipts.mapNotNull { r ->
            val ticketId = r.ticketId ?: return@mapNotNull null
            val platform = platformByToken[r.token] ?: return@mapNotNull null
            if (r.status != PushStatus.SENT || ticketId.length > PushTicket.TICKET_ID_MAX || r.token.length > PushToken.TOKEN_MAX) {
                return@mapNotNull null
            }
            PushTicket(ticketId, notification.notificationId, r.token, platform, now)
        }
        if (rows.isEmpty()) return
        runCatching { tickets.record(rows) }
            .onFailure { log.warn("푸시 티켓을 기록하지 못했습니다 — 이 발송은 영수증 확인에서 빠집니다. notificationId={}", notification.notificationId, it) }
    }

    /**
     * 두 창 중 **하나라도** 넘으면 상한이다. 시간 창만 보면 하루 종일 9건씩(216건) 나가고,
     * 일 창만 보면 한 시간에 50건이 몰려 레이트리밋을 그대로 맞는다.
     */
    private fun overLimit(accountId: UUID): Boolean {
        val now = clock.instant()
        val counts = notifications.countPushed(accountId, now.minus(1, ChronoUnit.HOURS), now.minus(1, ChronoUnit.DAYS))
        return counts.inHour >= limits.hourly || counts.inDay >= limits.daily
    }

    private fun record(notificationId: UUID, sentAt: java.time.Instant?, reason: String?) {
        notifications.markPushResult(notificationId, sentAt, reason?.take(REASON_MAX))
    }

    /**
     * 대표 사유 하나. 기기마다 다를 수 있어 **가장 흔한 것**을 남긴다(전부 남기면 컬럼이 넘친다).
     *
     * 사유가 없는 영수증은 상태로 센다. **죽은 토큰은 원인 하나에 표기 하나다** — Expo 표기
     * `DeviceNotRegistered`(정본 OBS-U6-02)로 접는다. 상태 이름으로 따로 세면 같은 원인이 두 표로 갈려
     * 다수결에서 소수에 지고, 컬럼·지표에도 두 값으로 남는다.
     */
    private fun reasonOf(receipts: List<com.trippilot.notification.domain.PushReceipt>): String =
        receipts.groupingBy { it.reason ?: if (it.status == PushStatus.DEVICE_NOT_REGISTERED) DEVICE_NOT_REGISTERED_REASON else it.status.name }
            .eachCount().maxByOrNull { it.value }?.key ?: "UNKNOWN"

    private fun Notification.toMessage() = PushMessage(
        title = title,
        body = body,
        // 탭 목적지는 알림함 행이 이미 들고 있다 — 푸시가 따로 만들지 않는다.
        data = buildMap {
            actionType?.let { put("actionType", it) }
            actionPayload?.forEach { (k, v) -> put(k, v) }
        },
        // 종류가 긴급도를 정한다 — 발송 지점이 따로 판단하지 않는다(어휘의 주인은 NotificationKind 하나다).
        urgency = kind.urgency,
    )

    private companion object {
        /** `notification.push_failed_reason` 컬럼 상한과 같아야 한다. */
        private const val REASON_MAX = 200

        /** Expo 어댑터가 죽은 토큰에 남기는 사유와 같은 표기(`ExpoPushAdapter` · ExpoPushReceiptTest). */
        private const val DEVICE_NOT_REGISTERED_REASON = "DeviceNotRegistered"

        /** 지표의 레이트리밋 칸(OBS-U6-02). Expo 티켓의 발송 속도 초과 코드와 같은 값이라 한 칸으로 모인다. */
        private const val RATE_LIMITED_REASON = "MessageRateExceeded"

        private val log = LoggerFactory.getLogger(PushDispatchService::class.java)
    }
}
