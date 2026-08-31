package com.trippilot.notification.domain

import java.time.Duration
import java.time.Instant
import java.util.UUID

/**
 * 시각 기반 리마인드 예약 한 건(U6 정본 §2.4 · DEC-U6-10).
 *
 * 예약은 사건이 아니라 **예정**이다. 그래서 일정이 다시 짜이면 미발화분은 통째로 갈아끼운다(INV-U6-08).
 *
 * @property slotKey `SLOT_PRE` 만 갖는 경계 키 `"{date}#{poiId}"`(BR-U2-04).
 */
data class NotificationSchedule(
    val scheduleId: UUID,
    val accountId: UUID,
    val tripId: UUID,
    val kind: NotificationKind,
    val slotKey: String?,
    val fireAt: Instant,
    val firedAt: Instant?,
    val canceledAt: Instant?,
) {
    init {
        require(kind in NotificationKind.REMINDERS) { "시각으로 발화하지 않는 종류는 예약할 수 없습니다: $kind" }
        require(kind == NotificationKind.SLOT_PRE || slotKey == null) { "slotKey 는 SLOT_PRE 만 가집니다." }
    }

    /**
     * **INV-U6-09** — 서버가 멈춰 있던 사이 시각이 지나 버렸는가.
     *
     * 폴링 주기만큼은 늘 늦게 집히므로 유예([grace])를 둔다. 그 밖이면 발화하지 않는다 —
     * "한 시간 전에 시작했어야 할 일정"을 지금 알리는 것은 도움이 아니라 방해다.
     */
    fun isTooLate(now: Instant, grace: Duration): Boolean = fireAt.plus(grace).isBefore(now)

    /**
     * 발화 결과로 남는 알림. 시각은 [fireAt] 이 아니라 **실제 발화 시각**을 쓴다 —
     * 화면이 "10분 전"처럼 상대 시각으로 그리므로 예정 시각을 쓰면 오차만큼 어긋난 말이 된다.
     */
    fun toNotification(now: Instant): Notification = Notification.raise(
        accountId = accountId,
        kind = kind,
        title = title(),
        body = body(),
        occurredAt = now,
        // 알림에서 그 여행의 일정으로 들어간다. 진입이 없으면 사용자가 알림을 읽고도 갈 곳이 없다.
        actionType = NotificationAction.TRIP_ITINERARY,
        actionPayload = mapOf("tripId" to tripId.toString()),
        // 원천 사건이 없다(시각이 되어 발화했다) — 멱등은 fired_at 조건부 쓰기가 담당한다.
        sourceEventId = null,
        // 예정 시각까지 넣어야 같은 여행의 두 리마인드가 구분된다(하루치가 여럿이다).
        dedupKey = "$kind#$tripId#$fireAt",
    )

    private fun title(): String = when (kind) {
        NotificationKind.TRIP_PRE -> "내일 여행이 시작돼요"
        NotificationKind.TRIP_DAY -> "오늘의 일정"
        else -> "일정 시작 전이에요"
    }

    private fun body(): String = when (kind) {
        NotificationKind.TRIP_PRE -> "출발 전에 일정을 한 번 확인해 보세요."
        NotificationKind.TRIP_DAY -> "오늘 어디를 가는지 확인해 보세요."
        else -> "곧 다음 일정이 시작돼요."
    }

    companion object {

        /** 아직 발화도 취소도 되지 않은 예약 — 재계산·폴링의 대상이 정확히 이 집합이다. */
        fun pending(
            accountId: UUID,
            tripId: UUID,
            kind: NotificationKind,
            fireAt: Instant,
            slotKey: String? = null,
        ) = NotificationSchedule(
            scheduleId = UUID.randomUUID(),
            accountId = accountId,
            tripId = tripId,
            kind = kind,
            slotKey = slotKey,
            fireAt = fireAt,
            firedAt = null,
            canceledAt = null,
        )
    }
}
