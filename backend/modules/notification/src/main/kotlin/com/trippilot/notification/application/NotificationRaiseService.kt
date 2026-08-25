package com.trippilot.notification.application

import com.trippilot.notification.domain.Notification
import com.trippilot.notification.domain.NotificationKind
import com.trippilot.notification.domain.NotificationRepository
import com.trippilot.trip.api.TripOwnerFacade
import org.slf4j.LoggerFactory
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import java.time.Clock
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
    private val clock: Clock,
) {
    /**
     * 적재하고 푸시까지 시도한다. 이미 있는 사건이면(`source_event_id` UNIQUE) **아무 일도 하지
     * 않는다** — at-least-once 재배달이 사용자에게 두 번 울리지 않는다(INV-U6-01 · BR-U6-34).
     */
    @Transactional
    @Suppress("LongParameterList")
    fun raise(
        accountId: UUID,
        kind: NotificationKind,
        title: String,
        body: String,
        sourceEventId: UUID,
        dedupKey: String?,
        actionType: String? = null,
        actionPayload: Map<String, String>? = null,
    ) {
        if (!toggles.allowsInApp(accountId, kind)) {
            log.debug("인앱 수신이 꺼진 종류라 적재하지 않습니다. kind={}", kind)
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
            return
        }
        pushes.dispatch(notification)
    }

    /**
     * 여행 소유자. 계정을 싣지 않는 이벤트(회고)가 쓴다 — **삭제된 여행이면 null** 이라 알림도
     * 만들어지지 않는다(지워진 여행의 회고 알림은 갈 곳이 없다).
     */
    @Transactional(readOnly = true)
    fun ownerOfTrip(tripId: UUID): UUID? = trips.findOwnedPeriod(tripId)?.accountId

    private companion object {
        private val log = LoggerFactory.getLogger(NotificationRaiseService::class.java)
    }
}
