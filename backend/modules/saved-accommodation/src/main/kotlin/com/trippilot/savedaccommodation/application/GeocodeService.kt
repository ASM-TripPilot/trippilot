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

    /**
     * 핀 지정(e05 3번째 탭) — 사용자가 지도를 길게 눌러 **좌표를 이미 정한** 상태에서 주소만 붙인다.
     *
     * 여기서 주소를 못 얻어도 **등록은 막히지 않는다.** 등록에 필요한 것은 확정된 좌표이고(BR-U1-22),
     * 이 경로는 지도 검색이 죽었을 때의 폴백이라(BR-U1-23) 같은 벤더가 여기서도 죽어 있을 수 있다.
     * 그래서 실패를 503 으로 정직하게 올리되, 화면은 그것을 "주소 미확인"으로 그리고 이름을 직접
     * 받아 등록을 계속한다 — 이 구분이 openapi 설명에 적혀 있다.
     *
     * @return 주소. **null 은 그 좌표에 주소가 없다는 사실**(바다·산)이며 조회 실패와 다르다.
     */
    fun reverseGeocode(lat: Double, lng: Double): String? {
        try {
            return placeSearch.reverseGeocode(lat, lng)
        } catch (e: UpstreamUnavailable) {
            throw UpstreamUnavailable(
                source = e.source,
                fallbackApplied = false, // 주소는 지어낼 수 없다 — 틀린 주소로 등록되면 사용자가 딴 데를 찾아간다
                message = "주소를 지금 확인할 수 없습니다. 숙소 이름을 직접 입력해 등록할 수 있어요.",
                cause = e,
            )
        }
    }
}
