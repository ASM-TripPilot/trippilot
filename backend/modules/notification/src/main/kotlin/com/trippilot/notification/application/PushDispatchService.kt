package com.trippilot.notification.application

import com.trippilot.notification.domain.Notification
import com.trippilot.notification.domain.NotificationRepository
import com.trippilot.notification.domain.PushMessage
import com.trippilot.notification.domain.PushPort
import com.trippilot.notification.domain.PushStatus
import com.trippilot.notification.domain.PushTokenRepository
import org.slf4j.LoggerFactory
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
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
) {
    /**
     * 발송 결과를 **한 자리에서** 센다(OBS-U6-02). 반환 지점이 다섯이라 각 자리에서 세면 하나를
     * 빠뜨려도 드러나지 않는다 — 빠뜨린 경로만 지표에서 조용히 사라진다.
     */
    @Transactional
    fun dispatch(notification: Notification): PushOutcome {
        var reason: String? = null
        val outcome = doDispatch(notification) { reason = it }
        metrics.pushDispatched(outcome, reason, push.deliversExternally)
        return outcome
    }

    private inline fun doDispatch(notification: Notification, onReason: (String) -> Unit): PushOutcome {
        // 종류 토글 × OS 권한 = 채널 판정. `SYSTEM` 은 토글을 타지 않는다(INV-U6-03).
        if (!toggles.allowsPush(notification.accountId, notification.kind)) return PushOutcome.MUTED
        // 권한이 없는 기기는 쏴도 닿지 않는다 — 시도 자체를 하지 않는다(레이트리밋을 아낀다).
        val deliverable = tokens.findActive(notification.accountId).filter { it.deliverable }
        if (deliverable.isEmpty()) return PushOutcome.NO_DEVICE

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
                // 발송기 자체가 터진 경우(네트워크·설정). 알림은 이미 알림함에 있다.
                record(notification.notificationId, sentAt = null, reason = "PUSH_ERROR: ${e.javaClass.simpleName}")
                onReason("PUSH_ERROR")
                log.warn("푸시 발송에 실패했습니다. notificationId={} 원인={}", notification.notificationId, e.toString())
                return PushOutcome.FAILED
            }

        receipts.filter { it.status == PushStatus.DEVICE_NOT_REGISTERED }.forEach {
            // INV-U6-07 — **즉시** 무효화한다. 다음 발송 때 다시 만나면 그때는 후보에도 없다.
            if (tokens.invalidate(it.token, now)) log.info("죽은 푸시 토큰을 무효화했습니다.")
        }

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

    /** 대표 사유 하나. 기기마다 다를 수 있어 **가장 흔한 것**을 남긴다(전부 남기면 컬럼이 넘친다). */
    private fun reasonOf(receipts: List<com.trippilot.notification.domain.PushReceipt>): String =
        receipts.groupingBy { it.reason ?: it.status.name }.eachCount().maxByOrNull { it.value }?.key ?: "UNKNOWN"

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

        private val log = LoggerFactory.getLogger(PushDispatchService::class.java)
    }
}
