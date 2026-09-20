package com.trippilot.itinerarygeneration.application

import com.trippilot.itinerarygeneration.api.ItineraryFacade
import com.trippilot.itinerarygeneration.api.ItineraryPlanFacade
import com.trippilot.itinerarygeneration.api.PlannedSlotView
import com.trippilot.itinerarygeneration.api.ItineraryRef
import com.trippilot.itinerarygeneration.domain.ItineraryRepository
import com.trippilot.trip.api.TripFacade
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import java.time.LocalDate
import java.util.UUID

/**
 * [ItineraryFacade] 구현 — 소유 스코프를 적용해 api-safe 요약만 노출한다.
 * 타 계정·없는 여행은 null(존재 은닉, 다른 서비스들과 같은 규칙).
 */
@Service
class ItineraryReadFacade(
    private val trips: TripFacade,
    private val itineraries: ItineraryRepository,
    // 이름 규칙(확정분은 동결본이 이긴다)을 다시 쓰지 않는다 — 이미 이 조립기가 소유한다.
    private val surfaces: SlotSurfaceAssembler,
) : ItineraryFacade, ItineraryPlanFacade {

    @Transactional(readOnly = true)
    override fun findCurrent(accountId: UUID, tripId: UUID): ItineraryRef? {
        trips.findPeriod(accountId, tripId) ?: return null
        val itinerary = itineraries.findByTrip(tripId).firstOrNull() ?: return null
        return ItineraryRef(
            itineraryId = itinerary.itineraryId,
            status = itinerary.status.name,
            generationState = itinerary.generationState.name,
            dates = itinerary.days.map { it.date },
            // 물리 키가 아니라 경계 키로 넘긴다 — 재계획으로 슬롯 행이 갈려도 참조가 끊기지 않는다(BR-U2-04).
            slotKeys = itinerary.days.flatMap { d -> d.slots.map { SlotKey.of(d.date, it.sourcePoiId) } },
        )
    }

    /**
     * 계획 슬롯 — 기록 화면(U5)이 실적과 견주는 왼쪽 열이다. 요약([findCurrent])이 슬롯 키만 주는 것과
     * 달리 **계획 시각**까지 준다. 없거나 타 계정이면 빈 목록이다(존재 은닉 매핑은 호출측 몫).
     */
    @Transactional(readOnly = true)
    override fun findPlanSlots(accountId: UUID, tripId: UUID): List<PlannedSlotView> {
        trips.findPeriod(accountId, tripId) ?: return emptyList()
        val itinerary = itineraries.findByTrip(tripId).firstOrNull() ?: return emptyList()
        return itinerary.days.flatMap { day ->
            day.slots.map {
                PlannedSlotView(
                    slotKey = SlotKey.of(day.date, it.sourcePoiId),
                    date = day.date,
                    poiId = it.sourcePoiId,
                    orderIndex = it.orderIndex,
                    startAt = it.startAt,
                    endAt = it.endAt,
                    isFixed = it.isFixed,
                    endsNextDay = it.endsNextDay,
                )
            }
        }
    }

    /**
     * 날짜별 방문 장소 이름(TRIP-883). 표면을 못 찾은 슬롯은 빼고, 그래서 비게 된 날은 **키까지 뺀다** —
     * 빈 목록으로 남기면 호출측이 "그 날은 일정이 없다"로 읽는데 그건 사실이 아니다(이름만 모른다).
     */
    @Transactional(readOnly = true)
    override fun findPlannedPlaceNames(accountId: UUID, tripId: UUID): Map<LocalDate, List<String>> {
        trips.findPeriod(accountId, tripId) ?: return emptyMap()
        val itinerary = itineraries.findByTrip(tripId).firstOrNull() ?: return emptyMap()
        val byPoi = surfaces.assemble(itinerary)
        return itinerary.days.associate { day ->
            // 문구는 동선 순서로 읽힌다. 여기서 다시 정렬하지 않는 것은 `ItineraryDay.of` 가
            // 이미 orderIndex 로 정렬해 보관하기 때문이다 — 두 곳에서 정렬하면 한쪽을 고쳐도
            // 다른 쪽이 가려 준다(역검증에서 실제로 아무것도 안 죽었다).
            day.date to day.slots.mapNotNull { byPoi[it.sourcePoiId]?.nameKo }
        }.filterValues { it.isNotEmpty() }
    }
}
