package com.trippilot.placedata.application

import com.trippilot.placedata.api.Area
import com.trippilot.placedata.api.CandidatePoolPort
import com.trippilot.placedata.api.GroundedPlace
import com.trippilot.placedata.domain.BoundingBox
import com.trippilot.placedata.domain.Haversine
import com.trippilot.placedata.domain.Poi
import com.trippilot.placedata.domain.PoiCategory
import com.trippilot.placedata.domain.PoiRepository
import org.springframework.stereotype.Service
import java.util.UUID

/**
 * [CandidatePoolPort] 구현 — 212 POI 정본 위 RAG 후보풀. **closed-set(INV-1)**: ACTIVE만, 반경 밖 배제.
 * 반경은 bounding-box 프리필터(DB) → 하버사인 정밀 컷(순수). api-safe 타입으로 노출.
 */
@Service
class PlaceDataCandidatePool(
    private val repo: PoiRepository,
    /**
     * 지역 이름 해석을 **탐색과 같은 규칙으로** 한다(TRIP-503). 여기서 따로 이름 일치로 거르면
     * 후보풀에 다른 도시가 섞이거나(`동구`) 광역 조회가 비어(`부산` 8/149) 생성 품질이 조용히 나빠진다.
     */
    private val poiQuery: PoiQueryService,
) : CandidatePoolPort {

    override fun resolve(area: Area, categories: Set<String>): List<GroundedPlace> {
        val cats = categories.mapNotNull { runCatching { PoiCategory.valueOf(it) }.getOrNull() }.toSet()
        fun matchesCat(poi: Poi) = cats.isEmpty() || poi.category in cats

        return when (area) {
            is Area.Region ->
                poiQuery.allIn(area.region, null).filter(::matchesCat).map { it.grounded(null) }

            is Area.Radius -> {
                val box = BoundingBox.around(area.centerLat, area.centerLng, area.radiusM)
                repo.findActiveInBounds(box.latMin, box.latMax, box.lngMin, box.lngMax)
                    .filter(::matchesCat)
                    .mapNotNull { poi ->
                        val d = Haversine.meters(area.centerLat, area.centerLng, poi.lat, poi.lng)
                        if (d <= area.radiusM) poi.grounded(d) else null // 반경 밖 배제
                    }
            }
        }
    }

    override fun ground(poiIds: List<UUID>): List<GroundedPlace> =
        repo.findActiveByIds(poiIds).map { it.grounded(null) }

    private fun Poi.grounded(distanceM: Double?) =
        GroundedPlace(poiId, nameKo, lat, lng, category.name, region, distanceM)
}
