package com.trippilot.notification.application

import com.trippilot.notification.domain.Notification
import com.trippilot.notification.domain.NotificationKind
import com.trippilot.notification.domain.NotificationRepository
import com.trippilot.trip.api.TripOwnerFacade
import org.slf4j.LoggerFactory
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import java.time.Clock
import java.time.Duration
import java.util.UUID

/**
 * 도메인 사건에서 온 알림을 적재한다(TRIP-550 · U6 §2.1 ③④).
 *
 * ## 적재가 먼저, 푸시는 그 다음
 *
 * ③이 ④보다 먼저라는 것이 U6 흐름의 핵심이다(INV-U6-02). 인앱함 적재가 푸시 성공 여부와
 * 무관해야 catch-up 이 "누락 0"이 된다 — 앱이 3일 꺼져 있어도 잃지 않는다.
 *
 * ## 인앱 토글이 꺼져 있으면 적재하지 않는다
 *
 * BR-U6-36 은 "억제된 알림도 인앱함에는 남긴다"고 하지만 그 억제는 **중복·빈도·조용시간**이다.
 * 사용자가 그 종류의 인앱 수신 자체를 끈 것은 다른 이야기라 발화기(TRIP-547)와 같은 판정을 쓴다.
 * `SYSTEM` 은 여기서 걸리지 않는다(INV-U6-03).
 */
@Service
class NotificationRaiseService(
    private val notifications: NotificationRepository,
    private val toggles: NotificationToggleService,
    private val pushes: PushDispatchService,
    private val trips: TripOwnerFacade,
    private val metrics: NotificationMetrics,
    private val clock: Clock,
) {
    /**
     * 적재하고 [push] 정책대로 푸시를 시도한다. 이미 있는 사건이면(`source_event_id` UNIQUE) **아무 일도
     * 하지 않는다** — at-least-once 재배달이 사용자에게 두 번 울리지 않는다(INV-U6-01 · BR-U6-34).
     */
    @Transactional
    fun raise(
        accountId: UUID,
        kind: NotificationKind,
        title: String,
        body: String,
        sourceEventId: UUID,
        dedupKey: String?,
        actionType: String? = null,
        actionPayload: Map<String, String>? = null,
        push: PushPolicy = PushPolicy.Always,
    ) {
        if (!toggles.allowsInApp(accountId, kind)) {
            log.debug("인앱 수신이 꺼진 종류라 적재하지 않습니다. kind={}", kind)
            metrics.suppressed(SuppressReason.IN_APP_OFF)
            return
        }
        val notification = Notification.raise(
            accountId = accountId,
            kind = kind,
            title = title,
            body = body,
            occurredAt = clock.instant(),
            actionType = actionType,
            actionPayload = actionPayload,
            sourceEventId = sourceEventId,
            dedupKey = dedupKey,
        )
        // **삽입되지 않았으면 그것으로 끝이다.** 재배달인데 푸시를 또 쏘면 사용자에게 두 번 울린다 —
        // UNIQUE 가 막아 준 중복이 푸시 경로로 새어 나가는 자리다.
        if (!notifications.appendIfAbsent(notification)) {
            log.debug("이미 적재된 사건입니다(재배달). eventId={}", sourceEventId)
            metrics.suppressed(SuppressReason.DUPLICATE)
            return
        }
        // 정책 판정은 적재가 성공한 **뒤**다(BR-SA-21 ②) — 재배달은 위에서 끝났으므로 억제 지표를 두 번
        // 세지 않는다. 막는 것은 푸시뿐이고, 알림함 행은 이미 있다(INV-U6-02).
        when (push) {
            PushPolicy.Always -> pushes.dispatch(notification)
            PushPolicy.InAppOnly -> {
                log.debug("푸시 대상이 아닌 사건이라 알림함에만 둡니다. eventId={}", sourceEventId)
                metrics.suppressed(SuppressReason.IN_APP_ONLY)
            }
            is PushPolicy.OncePer -> if (pushedWithin(notification, push)) {
                log.info("같은 묶음의 푸시가 {} 안에 나가 이번 푸시를 생략합니다. eventId={}", push.window, sourceEventId)
                metrics.suppressed(SuppressReason.COALESCED)
            } else {
                pushes.dispatch(notification)
            }
        }
    }

    /**
     * [policy] 접두의 알림 중 [PushPolicy.OncePer.window] 안에 **실제로 푸시된**(`push_sent_at`) 것이 있는가.
     *
     * 기존 조회(최근 [RECENT] 건)를 메모리에서 거른다 — 포트·SQL 을 늘리지 않는다. 그 대가로 한 계정에
     * 창 안 알림이 [RECENT] 건을 넘으면 앞선 푸시를 못 볼 수 있다(감지는 여행·회차당 사건 1건이라 전제 밖 —
     * INV-SA-3). 릴레이는 단일 실행(ShedLock)이라 같은 묶음의 두 사건이 이 판정을 동시에 지나지 않는다.
     * 알림함만·실패·상한으로 안 나간 행은 발송 시각이 없어 근거가 되지 않는다 — 과잉 억제를 막는다.
     */
    private fun pushedWithin(notification: Notification, policy: PushPolicy.OncePer): Boolean {
        val since = notification.occurredAt.minus(policy.window)
        // 방금 적재한 행은 아직 발송 시각이 없어 스스로 걸리지 않는다.
        return notifications.findByAccount(notification.accountId, unreadOnly = false, limit = RECENT).any {
            it.dedupKey?.startsWith(policy.dedupPrefix) == true && it.pushSentAt?.isAfter(since) == true
        }
    }

    /**
     * 여행 소유자. 계정을 싣지 않는 이벤트(회고)가 쓴다 — **삭제된 여행이면 null** 이라 알림도
     * 만들어지지 않는다(지워진 여행의 회고 알림은 갈 곳이 없다).
     */
    @Transactional(readOnly = true)
    fun ownerOfTrip(tripId: UUID): UUID? = trips.findOwnedPeriod(tripId)?.accountId

    private companion object {
        /** 묶음 판정이 보는 최근 알림 수 — 알림함 목록 기본값과 같다. */
        private const val RECENT = 50

        private val log = LoggerFactory.getLogger(NotificationRaiseService::class.java)
    }
}

/**
 * 적재 뒤 푸시를 어떻게 할 것인가(BR-SA-21 ②). 판정은 적재가 성공한 뒤이고, 막는 것은 푸시뿐이다.
 */
sealed interface PushPolicy {
    /** 언제나 시도한다 — 종전 동작(숙소·회고). */
    data object Always : PushPolicy

    /** 알림함에만 둔다 — 사건이 푸시 대상이 아니다(주의·하루 상한 초과·모르는 값). */
    data object InAppOnly : PushPolicy

    /** 같은 [dedupPrefix] 의 푸시가 [window] 안에 나갔으면 이번 푸시를 생략한다(BR-U6-09 개정). */
    data class OncePer(val dedupPrefix: String, val window: Duration) : PushPolicy
}
