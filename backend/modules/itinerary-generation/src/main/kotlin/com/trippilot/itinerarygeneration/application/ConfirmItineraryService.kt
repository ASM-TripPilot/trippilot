package com.trippilot.itinerarygeneration.application

import com.trippilot.core.error.ConflictDetected
import com.trippilot.core.error.ResourceNotFound
import com.trippilot.core.event.DomainEventPublisher
import com.trippilot.itinerarygeneration.api.event.ItineraryConfirmed
import com.trippilot.itinerarygeneration.domain.Itinerary
import com.trippilot.itinerarygeneration.domain.ItineraryRepository
import com.trippilot.itinerarygeneration.domain.ItineraryStatus
import com.trippilot.placedata.api.PoiSnapshotFacade
import com.trippilot.trip.api.TripFacade
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import java.time.Clock
import java.util.UUID

/**
 * 일정 확정(C8 · US-SCHED-08) — PLANNED→CONFIRMED 단방향 잠금 + poi_snapshot 동결(INV-U1-03).
 * 확정 시 각 슬롯 POI 를 스냅숏으로 동결(값 보존) — 하나라도 비-ACTIVE/소실이면 확정 불가(400).
 * 여행 없음·삭제·타 계정·생성 이력 없음은 404(존재 은닉). 이미 확정이면 409.
 */
@Service
class ConfirmItineraryService(
    private val trips: TripFacade,
    private val itineraries: ItineraryRepository,
    private val poiSnapshots: PoiSnapshotFacade,
    private val events: DomainEventPublisher,
    private val clock: Clock,
) {
    @Transactional
    fun confirm(accountId: UUID, tripId: UUID): Itinerary {
        trips.findPeriod(accountId, tripId) ?: throw ResourceNotFound() // 소유·존재(404 은닉)
        val current = itineraries.findByTrip(tripId).firstOrNull() ?: throw ResourceNotFound("생성된 일정이 없습니다.")
        // 재확정은 동결 전 조기 차단(409) — freeze 부작용 없이.
        if (current.status != ItineraryStatus.PLANNED) throw ConflictDetected(message = "이미 확정된 일정입니다.")

        // poi_snapshot 동결(INV-U1-03) — 전 슬롯 POI. 하나라도 동결 불가(비-ACTIVE/소실)면 확정 불가(409 상태 충돌).
        val poiIds = current.days.flatMap { it.slots }.map { it.sourcePoiId }.distinct()
        val snapshotByPoi = poiIds.associateWith { poiId ->
            poiSnapshots.freeze(poiId)?.poiSnapshotId
                ?: throw ConflictDetected(message = "일정에 포함된 장소가 더 이상 유효하지 않아 확정할 수 없습니다.")
        }

        val confirmed = itineraries.save(current.confirm(snapshotByPoi, clock.instant()))
        // 확정 이벤트 발행 — @Transactional 내(향후 아웃박스 relay가 커밋 경계에 바인딩).
        events.publish(ItineraryConfirmed(confirmed.itineraryId.toString(), tripId.toString()))
        return confirmed
    }
}
