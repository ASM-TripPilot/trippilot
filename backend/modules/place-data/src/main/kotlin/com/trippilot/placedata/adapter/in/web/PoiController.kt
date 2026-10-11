package com.trippilot.placedata.adapter.`in`.web

import com.trippilot.placedata.application.PoiQueryService
import com.trippilot.placedata.domain.PoiCategory
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PathVariable
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RequestParam
import org.springframework.web.bind.annotation.RestController
import java.util.UUID

/**
 * 장소(POI) 탐색 — 탐색 랜딩(US-EXPL-01). 목록은 ACTIVE만(INV-U1-01), 지역·카테고리 필터.
 * 단건은 폐업·유실도 상태와 함께 준다(미검증만 404 · TRIP-824).
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
        @RequestParam(required = false) q: String?,
        @RequestParam(required = false) cursor: String?,
        @RequestParam(required = false) limit: Int?,
    ): PlaceListResponse {
        val page = query.search(region, category, q, cursor, limit)
        return PlaceListResponse(page.items.map { PlaceResponse.from(it) }, page.nextCursor)
    }

    /** 단건 상세. 목록과 **같은 모양**이다 — 상세 전용 필드는 값이 채워질 때 붙인다(TRIP-824 잔여). */
    @GetMapping("/{poiId}")
    fun get(@PathVariable poiId: UUID): PlaceResponse = PlaceResponse.from(query.get(poiId))
}
