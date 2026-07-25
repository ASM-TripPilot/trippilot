package com.trippilot.accommodationsearch.adapter.`in`.web

import com.trippilot.accommodationsearch.application.StaySearchService
import com.trippilot.accommodationsearch.domain.StaySearchQuery
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RequestParam
import org.springframework.web.bind.annotation.RestController

/** 숙소 탐색 — `GET /api/v1/stays/search`. 날짜·인원 없이, 최저가순, amenity/stayType 필터(AND). */
@RestController
@RequestMapping("/api/v1/stays")
class StaySearchController(
    private val service: StaySearchService,
) {
    @GetMapping("/search")
    fun search(
        @RequestParam(required = false) region: String?,
        @RequestParam(required = false) amenity: List<String>?,
        @RequestParam(required = false) stayType: List<String>?,
    ): StaySearchResponse =
        StaySearchResponse.from(
            service.search(
                StaySearchQuery(
                    region = region,
                    amenities = amenity?.toSet() ?: emptySet(),
                    stayTypes = stayType?.toSet() ?: emptySet(),
                ),
            ),
        )
}
