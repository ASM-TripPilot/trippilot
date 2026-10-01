package com.trippilot.accommodationsearch.adapter.`in`.web

import com.trippilot.accommodationsearch.application.StayDetailService
import com.trippilot.accommodationsearch.application.StaySearchService
import com.trippilot.accommodationsearch.domain.Nearby
import com.trippilot.accommodationsearch.domain.StaySearchQuery
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PathVariable
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
    private val detail: StayDetailService,
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

    /**
     * 숙소 상세 — `GET /api/v1/stays/{stayId}` (US-STAY-03).
     *
     * **경로 순서에 기대지 않는다.** 이 템플릿은 같은 기저 경로의 리터럴(`/search` ·
     * 다른 컨트롤러의 `/geocode`·`/reverse-geocode`)보다 **덜 구체적이라** Spring 이 뒤로 민다.
     * 다만 그 규칙에 기대는 것과 확인하는 것은 다르다 — 셋이 계속 사는지 API 테스트가 못 박는다.
     *
     * [stayId] 는 `"{출처}:{식별자}"` 합성 문자열이다(복합 PK 를 경로에 싣는 유일한 길).
     * 형식이 틀리면 400, 그런 숙소가 없으면 404 — 둘을 같은 응답으로 접지 않는다.
     */
    @GetMapping("/{stayId}")
    fun detail(@PathVariable stayId: String): StayDetailResponse =
        StayDetailResponse.from(detail.detail(stayId))
}