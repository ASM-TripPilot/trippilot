package com.trippilot.placedata.adapter.`in`.web

import com.trippilot.placedata.application.PoiQueryService
import com.trippilot.placedata.domain.PoiCategory
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RequestParam
import org.springframework.web.bind.annotation.RestController

/**
 * 장소(POI) 탐색 — 탐색 랜딩(US-EXPL-01). ACTIVE만(INV-U1-01), 지역·카테고리 필터.
 * POI는 전역 자원(계정 스코프 아님). 반경/취향 후보풀은 CandidatePoolPort(TRIP-213).
 */
@RestController
@RequestMapping("/api/v1/places")
class PoiController(
    private val query: PoiQueryService,
) {
    @GetMapping
    fun list(
        @RequestParam(required = false) region: String?,
        @RequestParam(required = false) category: PoiCategory?,
    ): List<PlaceResponse> = query.search(region, category).map { PlaceResponse.from(it) }
}
