package com.trippilot.itinerarygeneration.api.event

import com.trippilot.core.event.DomainEvent

/**
 * 일정 생성/확정 도메인 이벤트(TRIP-230 계약) — api/event 패키지의 공개 계약(R1), 아카이브·알림 등 후속 훅이 소비.
 * 발행은 [com.trippilot.core.event.DomainEventPublisher](auth AccountCreated 선례). 아웃박스 영속(relay)은
 * 공통 인프라 후속 — 현재는 인프로세스 발행 계약만.
 */
data class ItineraryGenerated(
    override val aggregateId: String, // itineraryId
    val tripId: String,
    val isFallback: Boolean,          // INV-4 결정론 폴백 여부
) : DomainEvent {
    override val eventType: String = "itinerary.ItineraryGenerated"
    override val aggregateType: String = "Itinerary"
}

/** 일정 확정(PLANNED→CONFIRMED) 완료 — 잠금 후 공유·아카이브가 소비. */
data class ItineraryConfirmed(
    override val aggregateId: String, // itineraryId
    val tripId: String,
) : DomainEvent {
    override val eventType: String = "itinerary.ItineraryConfirmed"
    override val aggregateType: String = "Itinerary"
}
