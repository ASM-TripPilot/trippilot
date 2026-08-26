package com.trippilot.notification.application

import com.trippilot.notification.domain.Notification
import com.trippilot.notification.domain.NotificationRepository
import com.trippilot.notification.domain.NotificationSchedule
import com.trippilot.notification.domain.NotificationScheduleRepository
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

    override fun exists(accountId: UUID, notificationId: UUID) =
        stored.any { it.notificationId == notificationId && it.accountId == accountId }
}

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
