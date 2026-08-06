package com.trippilot.itinerarygeneration.application

import com.trippilot.core.error.ResourceNotFound
import com.trippilot.core.event.DomainEventPublisher
import com.trippilot.itinerarygeneration.api.event.ItineraryConfirmed
import com.trippilot.itinerarygeneration.domain.Itinerary
import com.trippilot.itinerarygeneration.domain.ItineraryRepository
import com.trippilot.trip.api.TripFacade
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import java.time.Clock
import java.util.UUID

/**
 * 일정 확정(C8 · US-SCHED-08) — PLANNED→CONFIRMED 단방향 잠금. 이미 확정이면 409(도메인).
 * 여행 없음·삭제·타 계정·생성 이력 없음은 404(존재 은닉).
 * poi_snapshot 동결(INV-U1-03)·확정 이벤트(아웃박스)는 후속 슬라이스 — 여기선 상태 전이만.
 */
@Service
class ConfirmItineraryService(
    private val trips: TripFacade,
    private val itineraries: ItineraryRepository,
    private val events: DomainEventPublisher,
    private val clock: Clock,
) {
    @Transactional
    fun confirm(accountId: UUID, tripId: UUID): Itinerary {
        trips.findPeriod(accountId, tripId) ?: throw ResourceNotFound() // 소유·존재(404 은닉)
        val current = itineraries.findByTrip(tripId).firstOrNull() ?: throw ResourceNotFound("생성된 일정이 없습니다.")
        val confirmed = itineraries.save(current.confirm(clock.instant())) // PLANNED→CONFIRMED(이미 확정이면 409)
        // 확정 이벤트 발행 — @Transactional 내(향후 아웃박스 relay가 커밋 경계에 바인딩).
        events.publish(ItineraryConfirmed(confirmed.itineraryId.toString(), tripId.toString()))
        return confirmed
    }
}
