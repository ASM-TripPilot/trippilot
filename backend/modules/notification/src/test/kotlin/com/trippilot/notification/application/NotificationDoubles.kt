package com.trippilot.notification.application

import com.trippilot.notification.domain.Notification
import com.trippilot.notification.domain.PushedCounts
import com.trippilot.notification.domain.NotificationRepository
import com.trippilot.notification.domain.NotificationSchedule
import com.trippilot.notification.domain.NotificationScheduleRepository
import com.trippilot.notification.domain.NotificationToggle
import com.trippilot.notification.domain.NotificationToggleRepository
import com.trippilot.trip.api.OwnedTripPeriod
import com.trippilot.trip.api.TripOwnerFacade
import java.time.Instant
import java.time.LocalDate
import java.util.UUID

/**
 * 인메모리 대역. **DB 가 판정하는 것은 여기서 흉내 내되, 흉내가 진짜 보증은 아니다** —
 * `source_event_id` UNIQUE 와 부분 인덱스는 실 DB IT(`NotificationScheduleIT`)가 본다.
 */
internal class FakeNotifications : NotificationRepository {
    val stored = mutableListOf<Notification>()

    /**
     * 발송량 상한 판정용(COST-U6-01). 대역은 **푸시가 나간 것으로 표시된** 행만 센다 —
     * 창 계산은 실 DB 가 하므로 여기서는 시각 비교만 흉내 낸다.
     */
    override fun countPushed(accountId: UUID, hourFrom: Instant, dayFrom: Instant): PushedCounts {
        val mine = stored.filter { it.accountId == accountId && it.pushSentAt != null }
        return PushedCounts(
            inHour = mine.count { it.pushSentAt!! >= hourFrom }.toLong(),
            inDay = mine.count { it.pushSentAt!! >= dayFrom }.toLong(),
        )
    }

    /** 관측 전용 집계(OBS-U6-04) — 대역에서는 읽음 표시가 안 된 것만 센다. */
    override fun countUnread(): Long = stored.count { it.readAt == null }.toLong()

    override fun appendIfAbsent(notification: Notification): Boolean {
        // UNIQUE 는 null 을 서로 다르게 본다 — 원천 사건이 없는 알림은 언제나 들어간다.
        if (notification.sourceEventId != null && stored.any { it.sourceEventId == notification.sourceEventId }) return false
        stored += notification
        return true
    }

    override fun findByAccount(accountId: UUID, unreadOnly: Boolean, limit: Int) =
        stored.filter { it.accountId == accountId && (!unreadOnly || it.readAt == null) }
            .sortedByDescending { it.occurredAt }
            .take(limit)

    override fun markRead(accountId: UUID, notificationId: UUID, at: Instant): Boolean {
        val i = stored.indexOfFirst { it.notificationId == notificationId && it.accountId == accountId && it.readAt == null }
        if (i < 0) return false
        stored[i] = stored[i].copy(readAt = at)
        return true
    }

    /** 실 DB 와 같은 규칙 — 내 것이면서 아직 안 읽은 것만, 종류는 안 가린다. */
    override fun markAllRead(accountId: UUID, at: Instant): Int {
        val targets = stored.withIndex().filter { (_, n) -> n.accountId == accountId && n.readAt == null }
        targets.forEach { (i, n) -> stored[i] = n.copy(readAt = at) }
        return targets.size
    }

    override fun exists(accountId: UUID, notificationId: UUID) =
        stored.any { it.notificationId == notificationId && it.accountId == accountId }

    /** 푸시 결과는 **기록만** 한다(INV-U6-02) — 알림의 존재를 좌우하지 않는다. */
    override fun markPushResult(notificationId: UUID, sentAt: Instant?, failedReason: String?) {
        val i = stored.indexOfFirst { it.notificationId == notificationId }
        if (i >= 0) stored[i] = stored[i].copy(pushSentAt = sentAt, pushFailedReason = failedReason)
    }
}

/**
 * 쏠 기기가 없는 발송기(TRIP-549).
 *
 * 발화 테스트가 푸시를 함께 검증하지 않는 이유는 **묻는 것이 다르기** 때문이다 — 그쪽은
 * "예약이 알림이 되는가", 푸시 채널 판정은 `PushDispatchPropertyTest` 가 본다. 토큰이 없으면
 * `NO_DEVICE` 로 조용히 끝나 발화 경로에 영향을 주지 않는다.
 */
internal fun noPush(clock: java.time.Clock, notifications: NotificationRepository, toggles: NotificationToggleService) =
    PushDispatchService(
        tokens = object : com.trippilot.notification.domain.PushTokenRepository {
            override fun register(token: com.trippilot.notification.domain.PushToken) = token
            override fun findActive(accountId: UUID) = emptyList<com.trippilot.notification.domain.PushToken>()
            override fun invalidate(token: String, at: Instant) = false
            override fun remove(accountId: UUID, token: String) = false
        },
        notifications = notifications,
        toggles = toggles,
        push = object : com.trippilot.notification.domain.PushPort {
            override val deliversExternally = false
            override fun send(tokens: List<String>, message: com.trippilot.notification.domain.PushMessage) =
                emptyList<com.trippilot.notification.domain.PushReceipt>()
        },
        metrics = testMetrics(notifications),
        limits = PushRateLimits(),
        clock = clock,
    )

/**
 * 계측 대역 — 지표는 **행동에 영향을 주지 않아야** 하므로 대부분의 테스트는 값을 보지 않는다.
 * 지표 자체를 재는 테스트는 자기 레지스트리를 따로 만들어 들여다본다(`NotificationMetricsTest`).
 */
internal fun testMetrics(notifications: NotificationRepository = FakeNotifications()) =
    NotificationMetrics(io.micrometer.core.instrument.simple.SimpleMeterRegistry(), notifications)

internal class FakeSchedules : NotificationScheduleRepository {
    val stored = mutableListOf<NotificationSchedule>()

    override fun replacePending(tripId: UUID, schedules: List<NotificationSchedule>) {
        stored.removeAll { it.tripId == tripId && it.firedAt == null && it.canceledAt == null }
        stored += schedules
    }

    override fun findDue(now: Instant, limit: Int) =
        stored.filter { it.firedAt == null && it.canceledAt == null && !it.fireAt.isAfter(now) }
            .sortedBy { it.fireAt }
            .take(limit)

    override fun markFired(scheduleId: UUID, at: Instant): Boolean = mark(scheduleId) { it.copy(firedAt = at) }

    override fun markCanceled(scheduleId: UUID, at: Instant): Boolean = mark(scheduleId) { it.copy(canceledAt = at) }

    override fun findPendingByTrip(tripId: UUID) =
        stored.filter { it.tripId == tripId && it.firedAt == null && it.canceledAt == null }.sortedBy { it.fireAt }

    /** 조건부 쓰기 — 이미 발화·취소된 행은 바뀌지 않는다(실 DB 의 WHERE 절과 같은 조건). */
    private fun mark(scheduleId: UUID, edit: (NotificationSchedule) -> NotificationSchedule): Boolean {
        val i = stored.indexOfFirst { it.scheduleId == scheduleId && it.firedAt == null && it.canceledAt == null }
        if (i < 0) return false
        stored[i] = edit(stored[i])
        return true
    }
}

internal class FakeTripOwner(private val periods: MutableMap<UUID, OwnedTripPeriod> = mutableMapOf()) : TripOwnerFacade {
    fun put(tripId: UUID, accountId: UUID, start: LocalDate, end: LocalDate) {
        periods[tripId] = OwnedTripPeriod(accountId, start, end)
    }

    fun remove(tripId: UUID) = periods.remove(tripId)

    override fun findOwnedPeriod(tripId: UUID) = periods[tripId]
}

/** 토글 대역. 저장이 없으면 기본값이 적용되는지(행이 없다 ≠ 꺼짐)까지 여기서 흉내 낸다. */
internal class FakeToggles : NotificationToggleRepository {
    val stored = mutableListOf<NotificationToggle>()
    override fun findByAccount(accountId: UUID) = stored.filter { it.accountId == accountId }
    override fun upsert(toggle: NotificationToggle) = toggle.also {
        stored.removeAll { t -> t.accountId == it.accountId && t.kind == it.kind }
        stored += it
    }
}
