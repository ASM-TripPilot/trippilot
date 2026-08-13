package com.trippilot.savedaccommodation.application

import com.trippilot.core.error.UpstreamUnavailable
import com.trippilot.savedaccommodation.domain.GeocodeCandidate
import com.trippilot.savedaccommodation.domain.PlaceSearchPort
import org.springframework.stereotype.Service

/**
 * 등록용 지오코딩(지도검색 경로). 빈 질의는 빈 결과.
 *
 * **실패를 빈 결과로 접지 않는다**(BR-U1-23 · ADR-0011 침묵 실패 금지). 빈 목록은 "그런 숙소를 못 찾았다"라
 * 사용자가 철자를 고쳐 다시 치게 되는데, 실제 원인이 벤더 장애면 몇 번을 쳐도 같다.
 * 503 으로 올려야 화면이 **핀 직접 지정 폴백**(`MapApiFallback`)을 띄운다.
 */
@Service
class GeocodeService(
    private val placeSearch: PlaceSearchPort,
) {
    fun geocode(query: String): List<GeocodeCandidate> {
        if (query.isBlank()) return emptyList()
        try {
            return placeSearch.geocode(query)
        } catch (e: UpstreamUnavailable) {
            // 문구를 여기서 다시 씌운다 — place-data 는 "벤더를 못 불렀다"까지만 알고,
            // 핀 지정이라는 대안이 있다는 것은 숙소 등록 화면(e05)의 사정이다.
            throw UpstreamUnavailable(
                source = e.source,
                fallbackApplied = false, // 좌표는 지어낼 수 없다 — 틀린 좌표로 등록되면 일정 전체가 어긋난다
                message = "장소 검색을 지금 이용할 수 없습니다. 지도에서 위치를 직접 지정해 주세요.",
                cause = e,
            )
        }
    }
}
