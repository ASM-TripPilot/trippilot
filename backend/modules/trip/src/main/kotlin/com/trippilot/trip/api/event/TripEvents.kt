package com.trippilot.trip.api.event

import com.trippilot.core.event.DomainEvent

/**
 * 여행이 끝났다(U5 정본 §6 · TRIP-554) — `api/event` 의 공개 계약(R1).
 *
 * **신설이다.** 정본은 U1 `trip` 이 발행한다고 적었지만 구현이 없었다(2026-08-25 실측: `grep TripEnded` 0건).
 * 이유가 있었다 — `TripStatus.ENDED` 는 저장되지 않고 날짜에서 파생돼(`Trip.statusAt`) **끝나는 순간이
 * 어디에도 없었다.** 그래서 이 티켓이 `trip.ended_at` 을 함께 만들었다: 사건에는 순간이 필요하다.
 *
 * 소비자는 아웃박스 릴레이 경유로 받는다(at-least-once) — 여행 요약(U5)이 첫 소비자다.
 * 중복 배달은 소비자가 거른다 — 요약은 `trip_summary` PK 로 한 행만 남고, 그 알림(`ReflectionReady`)은 행을 처음 만들 때만 나간다.
 */
data class TripEnded(
    override val aggregateId: String, // tripId
    val tripId: String,
    val endedAt: String,
) : DomainEvent {
    override val eventType: String = "trip.TripEnded"
    override val aggregateType: String = "Trip"
}

/**
 * 여행이 삭제됐다(소프트, BR-U1-42 · TRIP-1061).
 *
 * 소프트 삭제는 행이 남아 **FK CASCADE 가 닿지 않는다** — 알림 예약처럼 여행에 딸린 파생물은
 * 이 사건으로 스스로 정리해야 한다(첫 소비자: notification 의 리마인드 예약 비우기.
 * 안 비우면 삭제한 여행의 알림이 계속 울린다). 배달은 아웃박스 릴레이(at-least-once) —
 * 구독자는 멱등이어야 한다.
 */
data class TripDeleted(
    override val aggregateId: String, // tripId
    val tripId: String,
    val deletedAt: String,
) : DomainEvent {
    override val eventType: String = "trip.TripDeleted"
    override val aggregateType: String = "Trip"
}

/**
 * 여행 기간(시작일·종료일)이 바뀌었다 — 편집이 기간을 **실제로** 바꾼 때만 나간다(제목·인원·목적지만 바꾼 편집은 안 낸다).
 *
 * 기간에서 파생된 것은 이 사건으로 스스로 다시 계산한다 — 첫 소비자: notification 의 리마인드 예약
 * (안 하면 다음 일정 생성·재계획이 올 때까지 예약이 옛 날짜 그대로라 옛 날에 울리거나 새 날에 안 울린다).
 * 날짜는 새 값이다. 배달은 아웃박스 릴레이(at-least-once) — 구독자는 멱등이어야 한다.
 */
data class TripPeriodChanged(
    override val aggregateId: String, // tripId
    val tripId: String,
    val startDate: String,
    val endDate: String,
) : DomainEvent {
    override val eventType: String = "trip.TripPeriodChanged"
    override val aggregateType: String = "Trip"
}
