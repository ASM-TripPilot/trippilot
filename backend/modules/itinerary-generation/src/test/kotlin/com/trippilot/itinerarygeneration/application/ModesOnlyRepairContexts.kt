package com.trippilot.itinerarygeneration.application

import com.trippilot.placedata.api.RegionCenter
import com.trippilot.placedata.api.RegionLookupFacade
import com.trippilot.profile.api.PreferenceFacade
import com.trippilot.profile.api.PreferenceSnapshot
import com.trippilot.savedaccommodation.api.BaseAnchorFacade
import com.trippilot.savedaccommodation.api.DayAnchorView
import com.trippilot.trip.api.TripFacade
import java.time.LocalDate
import java.util.UUID

/**
 * 수단만 보는 수리 컨텍스트 대역 — 계정 취향 수단이 [modes] 다. 여행 컨텍스트는 [trips] 가 답한다(null 이면 수단도 빈다 — 실물과 같다).
 * 앵커 원천(숙소·지역)은 비어 있다 — 재검증(편집·되돌리기)은 앵커를 싣지 않는다.
 */
internal fun modesOnlyRepairContexts(trips: TripFacade, modes: List<String> = emptyList()) = RepairContexts(
    trips,
    object : BaseAnchorFacade {
        override fun findStayNightAnchors(tripId: UUID, startDate: LocalDate, endDate: LocalDate) = emptyList<DayAnchorView>()
    },
    object : RegionLookupFacade {
        override fun codesOf(regionName: String) = emptyList<String>()
        override fun isSelectableCode(regionCode: String) = false
        override fun centerOf(regionName: String): RegionCenter? = null
        override fun centerOfCode(regionCode: String): RegionCenter? = null
    },
    object : PreferenceFacade {
        override fun findPreferences(accountId: UUID) =
            PreferenceSnapshot(emptyList(), emptyList(), emptyList(), modes, null, emptyList(), false, null)
    },
)
