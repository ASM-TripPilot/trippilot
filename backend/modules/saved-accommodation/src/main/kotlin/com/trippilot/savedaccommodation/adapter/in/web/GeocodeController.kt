package com.trippilot.savedaccommodation.adapter.`in`.web

import com.trippilot.core.error.FieldError
import com.trippilot.core.error.ValidationFailed
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

    /**
     * 핀 지정 역지오코딩 — `GET /api/v1/stays/reverse-geocode?lat=&lng=`.
     *
     * 좌표는 **요청값을 그대로 돌려준다**. 벤더의 대표 좌표로 갈아끼우면 사용자가 찍은 자리와 다른 곳이
     * 등록된다 — 핀이 정본이다.
     */
    @GetMapping("/reverse-geocode")
    fun reverseGeocode(
        @RequestParam lat: Double,
        @RequestParam lng: Double,
    ): ReverseGeocodeResponse {
        // 범위 밖 좌표는 벤더에 묻지 않는다 — 형식 오류라 400 이 맞고, 물어봐야 어차피 결과가 없다.
        // `!in` 은 NaN·무한대도 함께 걸러 낸다(NaN 은 어떤 범위에도 속하지 않는다) — Nearby 와 같은 관례.
        val errors = buildList {
            if (lat !in -90.0..90.0) add(FieldError("lat", "위도는 -90 ~ 90 이어야 합니다."))
            if (lng !in -180.0..180.0) add(FieldError("lng", "경도는 -180 ~ 180 이어야 합니다."))
        }
        if (errors.isNotEmpty()) throw ValidationFailed(errors)

        return ReverseGeocodeResponse(service.reverseGeocode(lat, lng), lat, lng)
    }
}

/**
 * [address] 가 **null 이면 그 좌표에 주소가 없다**(바다·산·비주소 구역)는 사실이다.
 * 벤더 장애는 503 이라 이 null 과 구분된다 — 둘을 같은 값으로 접으면 화면이 잘못된 안내를 한다.
 */
data class ReverseGeocodeResponse(val address: String?, val lat: Double, val lng: Double)

data class GeocodeResponse(val name: String, val address: String, val lat: Double, val lng: Double) {
    companion object {
        fun from(c: GeocodeCandidate) = GeocodeResponse(c.name, c.address, c.lat, c.lng)
    }
}
