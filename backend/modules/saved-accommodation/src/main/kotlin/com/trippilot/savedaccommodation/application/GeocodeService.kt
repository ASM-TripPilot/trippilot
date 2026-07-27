package com.trippilot.savedaccommodation.application

import com.trippilot.savedaccommodation.domain.GeocodeCandidate
import com.trippilot.savedaccommodation.domain.PlaceSearchPort
import org.springframework.stereotype.Service

/** 등록용 지오코딩(지도검색 경로). 빈 질의는 빈 결과. */
@Service
class GeocodeService(
    private val placeSearch: PlaceSearchPort,
) {
    fun geocode(query: String): List<GeocodeCandidate> =
        if (query.isBlank()) emptyList() else placeSearch.geocode(query)
}
