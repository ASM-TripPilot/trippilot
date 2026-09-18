package com.trippilot.placedata.adapter.out.external

import com.trippilot.placedata.domain.GeoPoint
import com.trippilot.placedata.domain.RegionGeocodePort
import org.springframework.stereotype.Component

/**
 * 지오코딩 스텁(기본 모드) — 실 벤더 없이도 국내 판정이 돌아야 로컬·CI 가 외부에 묶이지 않는다.
 * CI 게이트 정책이 "외부 API 호출 0회"이므로 여기가 기본이다.
 *
 * 시드는 **국내로 판정돼야 하는 것만** 담는다. 없는 이름은 빈 목록 → 국외 판정이 된다.
 *
 * TRIP-360 이후 이 어댑터는 **목적지 통과 여부를 정하지 않는다** — 그건 카탈로그가 한다.
 * 여기 판정은 거절 사유를 가르는 데만 쓰이므로, 시드가 빈약하면 "국내인데 목록에 없음"이
 * "국외"로 뭉쳐 보인다. 사유가 중요한 화면을 붙일 때는 `PLACE_GEOCODE_MODE=kakao` 로 켠다.
 */
@Component
class StubRegionGeocodeAdapter : RegionGeocodePort {

    override fun searchAddress(query: String): List<GeoPoint> =
        ADDRESS[query.trim()]?.let { listOf(it) }.orEmpty()

    private companion object {
        private val ADDRESS = mapOf(
            "제주" to GeoPoint(33.4996, 126.5312),
            "제주특별자치도" to GeoPoint(33.4889, 126.4982),
            "부산" to GeoPoint(35.1796, 129.0756),
            "서울" to GeoPoint(37.5665, 126.9780),
            "경주" to GeoPoint(35.8562, 129.2247),
            "천안" to GeoPoint(36.8151, 127.1139),
            "속초시" to GeoPoint(38.2069, 128.5919),
            "사하구" to GeoPoint(35.1046, 128.9746),
            // **카탈로그 밖이지만 국내**인 사례(TRIP-360). 목적지 판정이 카탈로그로 넘어간 뒤
            // 지오코딩의 역할은 "왜 안 되는지"를 가르는 것뿐이다 — 읍·면 이름을 넣은 국내 사용자에게
            // "국내 여행만 지원해요" 라고 답하지 않으려면 여기에 국내로 아는 표본이 있어야 한다.
            "홍천읍" to GeoPoint(37.6971, 127.8888),
        )
    }
}
