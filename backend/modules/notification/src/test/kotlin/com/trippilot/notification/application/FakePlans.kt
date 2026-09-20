package com.trippilot.notification.application

import com.trippilot.itinerarygeneration.api.ItineraryPlanFacade
import com.trippilot.itinerarygeneration.api.PlannedSlotView
import java.time.LocalDate
import java.util.UUID

/**
 * 일정 대역 — 리마인드 문구의 재료(그 날 갈 곳 이름)만 돌려준다.
 *
 * 기본이 **빈 맵**인 것은 의도다: 재료가 없는 상태가 이 모듈의 기존 동작이었고, 그때 문구가
 * 통째로 안 나가는 것까지 스펙이 잡아야 한다.
 */
class FakePlans(private val namesByDate: Map<LocalDate, List<String>> = emptyMap()) : ItineraryPlanFacade {
    override fun findPlanSlots(accountId: UUID, tripId: UUID): List<PlannedSlotView> = emptyList()
    override fun findPlannedPlaceNames(accountId: UUID, tripId: UUID): Map<LocalDate, List<String>> = namesByDate
}
