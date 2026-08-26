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
    private val clock: Clock,
) {
    @Transactional
    fun dispatch(notification: Notification): PushOutcome {
        // 종류 토글 × OS 권한 = 채널 판정. `SYSTEM` 은 토글을 타지 않는다(INV-U6-03).
        if (!toggles.allowsPush(notification.accountId, notification.kind)) return PushOutcome.MUTED
        // 권한이 없는 기기는 쏴도 닿지 않는다 — 시도 자체를 하지 않는다(레이트리밋을 아낀다).
        val deliverable = tokens.findActive(notification.accountId).filter { it.deliverable }
        if (deliverable.isEmpty()) return PushOutcome.NO_DEVICE

        val now = clock.instant()
        // **유효 토큰 전부**에 보낸다(INV-U6-06 다기기) — 폰만 울리고 태블릿이 조용하면 그쪽을
        // 보고 있던 사용자는 놓친다.
        val receipts = runCatching { push.send(deliverable.map { it.token }, notification.toMessage()) }
            .getOrElse { e ->
                // 발송기 자체가 터진 경우(네트워크·설정). 알림은 이미 알림함에 있다.
                record(notification.notificationId, sentAt = null, reason = "PUSH_ERROR: ${e.javaClass.simpleName}")
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
            record(notification.notificationId, sentAt = null, reason = reasonOf(receipts))
            PushOutcome.FAILED
        }
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
    )

    private companion object {
        /** `notification.push_failed_reason` 컬럼 상한과 같아야 한다. */
        private const val REASON_MAX = 200

        private val log = LoggerFactory.getLogger(PushDispatchService::class.java)
    }
}
