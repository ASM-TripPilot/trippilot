package com.trippilot.notification.domain

import java.time.Instant
import java.util.UUID

/** 알림함 영속 포트. */
interface NotificationRepository {
    /**
     * 적재한다. 같은 [Notification.sourceEventId] 가 이미 있으면 **아무것도 하지 않고 false**(INV-U6-01).
     *
     * 판정을 앱에서 하지 않는다 — 선검사 후 삽입은 두 인스턴스가 동시에 통과할 수 있다.
     * 유니크 제약이 판정하고, 구현은 그 결과를 되돌려 줄 뿐이다.
     */
    fun appendIfAbsent(notification: Notification): Boolean

    /** 최신순. [unreadOnly] 면 미읽음만. */
    fun findByAccount(accountId: UUID, unreadOnly: Boolean, limit: Int): List<Notification>

    /** 이미 읽었거나 남의 알림이면 false. */
    fun markRead(accountId: UUID, notificationId: UUID, at: Instant): Boolean

    fun exists(accountId: UUID, notificationId: UUID): Boolean
}

/** 리마인드 예약 영속 포트. */
interface NotificationScheduleRepository {
    /**
     * 그 여행의 **미발화·미취소** 예약을 [schedules] 로 갈아끼운다(INV-U6-08).
     *
     * 이미 발화했거나 취소된 행은 건드리지 않는다 — 그건 지나간 사실이라 재계산의 대상이 아니다.
     * 같은 이벤트가 두 번 배달돼도 결과가 같다(아웃박스 at-least-once 대응).
     */
    fun replacePending(tripId: UUID, schedules: List<NotificationSchedule>)

    /** 발화 시각이 [now] 이하인 미발화·미취소 예약. */
    fun findDue(now: Instant, limit: Int): List<NotificationSchedule>

    /** 조건부 쓰기 — 다른 인스턴스가 이미 집었으면 false. */
    fun markFired(scheduleId: UUID, at: Instant): Boolean

    /** 조건부 쓰기 — 이미 발화·취소됐으면 false. */
    fun markCanceled(scheduleId: UUID, at: Instant): Boolean

    fun findPendingByTrip(tripId: UUID): List<NotificationSchedule>
}
