package com.trippilot.accommodationsearch.adapter.`in`.web

import com.trippilot.accommodationsearch.application.StaySearchService
import com.trippilot.accommodationsearch.domain.Nearby
import com.trippilot.accommodationsearch.domain.StaySearchQuery
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RequestParam
import org.springframework.web.bind.annotation.RestController

/**
 * 숙소 탐색 — `GET /api/v1/stays/search`. 날짜·인원 없이, 최저가순, amenity/stayType 필터(AND).
 * `lat`·`lng`(·`radiusKm`)로 '내 주변' 좌표 스코프(TRIP-202) — 조립·검증은 [Nearby.of] 가 하고,
 * 위반 시 던지는 `ValidationFailed` 를 전역 핸들러가 400 으로 바꾼다.
 */
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
        @RequestParam(required = false) lat: Double?,
        @RequestParam(required = false) lng: Double?,
        @RequestParam(required = false) radiusKm: Double?,
    ): StaySearchResponse =
        StaySearchResponse.from(
            service.search(
                StaySearchQuery(
                    region = region,
                    amenities = amenity?.toSet() ?: emptySet(),
                    stayTypes = stayType?.toSet() ?: emptySet(),
                    nearby = Nearby.of(lat, lng, radiusKm),
                ),
            ),
        )
}
