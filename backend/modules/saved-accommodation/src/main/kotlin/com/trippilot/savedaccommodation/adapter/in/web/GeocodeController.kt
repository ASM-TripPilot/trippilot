package com.trippilot.savedaccommodation.adapter.`in`.web

import com.trippilot.savedaccommodation.application.GeocodeService
import com.trippilot.savedaccommodation.domain.GeocodeCandidate
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RequestParam
import org.springframework.web.bind.annotation.RestController

/** 등록용 지오코딩 — `GET /api/v1/stays/geocode?q=`. multi-candidate 반환(사용자 선택). */
@RestController
@RequestMapping("/api/v1/stays")
class GeocodeController(
    private val service: GeocodeService,
) {
    @GetMapping("/geocode")
    fun geocode(@RequestParam q: String): List<GeocodeResponse> =
        service.geocode(q).map { GeocodeResponse.from(it) }
}

data class GeocodeResponse(val name: String, val address: String, val lat: Double, val lng: Double) {
    companion object {
        fun from(c: GeocodeCandidate) = GeocodeResponse(c.name, c.address, c.lat, c.lng)
    }
}
