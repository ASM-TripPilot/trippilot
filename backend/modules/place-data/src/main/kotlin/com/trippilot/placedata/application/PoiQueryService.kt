package com.trippilot.placedata.application

import com.trippilot.placedata.domain.Poi
import com.trippilot.placedata.domain.PoiCategory
import com.trippilot.placedata.domain.PoiRepository
import org.springframework.stereotype.Service

/**
 * POI 조회(C7) — 탐색 랜딩(US-EXPL-01)용. **ACTIVE만**(INV-U1-01) 지역·카테고리 필터.
 * 반경/취향 후보풀(CandidatePoolPort)은 TRIP-213.
 */
@Service
class PoiQueryService(
    private val repo: PoiRepository,
) {
    fun search(region: String?, category: PoiCategory?): List<Poi> = repo.findActive(region, category)
}
