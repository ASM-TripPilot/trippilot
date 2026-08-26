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
 * 중복 배달은 `trip_summary` PK 가 걸러 낸다.
 */
data class TripEnded(
    override val aggregateId: String, // tripId
    val tripId: String,
    val endedAt: String,
) : DomainEvent {
    override val eventType: String = "trip.TripEnded"
    override val aggregateType: String = "Trip"
}
