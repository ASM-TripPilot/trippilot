package com.trippilot.itinerarygeneration.application

import com.trippilot.itinerarygeneration.domain.RepairContext
import com.trippilot.placedata.api.RegionLookupFacade
import com.trippilot.profile.api.PreferenceFacade
import com.trippilot.savedaccommodation.api.BaseAnchorFacade
import com.trippilot.trip.api.TripFacade
import org.springframework.stereotype.Component
import java.time.LocalDate
import java.util.UUID

/**
 * 편집 수리(repair)에 실을 여행 컨텍스트(2026-10-05) — **generate 가 AI 에 보내는 것과 같은 출처**다.
 * 앵커 = [RegionAnchors.dayAnchors](숙소 → 그 날 목적지 중심 → 첫 목적지 중심), 수단 = 계정 취향
 * `transport_modes`(생성 프로필과 같은 값 — 개인화는 수단을 건드리지 않는다). 새로 계산하지 않는다.
 *
 * 앵커는 [dates] 의 날만 싣는다 — 앵커가 실린 날은 상대가 첫 슬롯을 앵커 이동만큼 밀 수 있어서,
 * 첫 구간이 안 바뀐 날까지 실으면 사용자가 옮겨 둔 시각이 그 편집과 무관하게 움직인다.
 */
@Component
class RepairContexts(
    private val trips: TripFacade,
    private val baseAnchors: BaseAnchorFacade,
    private val regions: RegionLookupFacade,
    private val preferences: PreferenceFacade,
) {
    fun of(accountId: UUID, tripId: UUID, dates: Set<LocalDate>): RepairContext {
        val ctx = trips.findGenerationContext(accountId, tripId) ?: return RepairContext.NONE
        val anchors = if (dates.isEmpty()) {
            emptyList()
        } else {
            val stays = baseAnchors.findStayNightAnchors(tripId, ctx.startDate, ctx.endDate)
            RegionAnchors.dayAnchors(regions, ctx.startDate, ctx.endDate, stays, ctx.destinationRefs).filter { it.date in dates }
        }
        return RepairContext(anchors, preferences.findPreferences(accountId).transportModes)
    }
}
