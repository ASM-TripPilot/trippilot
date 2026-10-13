package com.trippilot.assistant.application

import com.trippilot.assistant.domain.AssistantSurface
import com.trippilot.assistant.domain.ContextSnapshot
import com.trippilot.itinerarygeneration.api.ItineraryFacade
import com.trippilot.itinerarygeneration.api.ItineraryPlanFacade
import org.springframework.stereotype.Component
import java.time.LocalDate
import java.util.UUID

/**
 * 해석에 보낼 컨텍스트를 만든다(FD §5 · BR-U8-22). **이 스냅샷이 권한 경계다** — 여기 실리지 않은 것은 AI 가
 * 볼 방법이 없다. 프롬프트 주입이 "다른 사람 일정 보여줘"라고 해도 스냅샷에 그 데이터가 없다(PBT-U8-3).
 *
 * 읽기는 전부 `accountId` 로 소유를 확인하는 퍼사드를 탄다 — 남의 여행은 조회 단계에서 없는 것이다.
 * 칩 문구와 같은 읽기([TripContextReader]) 위에 선다: 칩이 말하는 것과 AI 가 보는 것이 다를 수 없다(BR-U8-03).
 */
@Component
class ContextSnapshotBuilder(
    private val tripContexts: TripContextReader,
    private val itineraries: ItineraryFacade,
    private val plans: ItineraryPlanFacade,
    private val properties: AssistantProperties,
) {
    fun build(accountId: UUID, tripId: UUID?, surface: AssistantSurface, today: LocalDate): ContextSnapshot {
        val trip = tripId?.let { tripContexts.read(accountId, it) }
            ?: return ContextSnapshot(surface, trip = null, baseStays = emptyList(), itinerary = null)
        val itinerary = itineraries.findCurrent(accountId, tripId)?.let { current ->
            val days = plans.findPlanSlots(accountId, tripId).groupBy { it.date }.toSortedMap().map { (date, slots) ->
                ContextSnapshot.DayBlock(
                    date,
                    slots.sortedBy { it.orderIndex }.map { ContextSnapshot.SlotBlock(it.slotKey, it.nameKo, it.startAt, it.category) },
                )
            }
            ContextSnapshot.ItineraryBlock(current.status, trim(days, today))
        }
        return ContextSnapshot(
            surface = surface,
            trip = ContextSnapshot.TripBlock(tripId, trip.destinations, trip.startDate, trip.endDate, trip.phase(today)),
            baseStays = listOfNotNull(trip.baseStayName),
            itinerary = itinerary,
        )
    }

    /**
     * 크기도 줄인다(SEC-U8-08) — 권한과 별개로 **양**이 비용이고 지연이다. 일자 수나 하루 슬롯 수가 상한을 넘으면
     * 오늘 ±1일만 보낸다. 오늘이 여행 기간 밖이면 첫 날을 기준으로 삼는다(여행 전에 긴 일정을 놓고 말하는 경우).
     */
    private fun trim(days: List<ContextSnapshot.DayBlock>, today: LocalDate): List<ContextSnapshot.DayBlock> {
        val withinLimits = days.size <= properties.snapshotMaxDays && days.all { it.slots.size <= properties.snapshotMaxSlotsPerDay }
        if (withinLimits) return days
        val pivot = days.map { it.date }.let { dates -> if (today in dates.first()..dates.last()) today else dates.first() }
        return days.filter { it.date in pivot.minusDays(1)..pivot.plusDays(1) }
            .map { it.copy(slots = it.slots.take(properties.snapshotMaxSlotsPerDay)) }
    }
}
