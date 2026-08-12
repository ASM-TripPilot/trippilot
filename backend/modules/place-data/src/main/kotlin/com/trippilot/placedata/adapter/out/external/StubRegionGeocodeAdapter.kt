package com.trippilot.placedata.adapter.out.external

import com.trippilot.placedata.domain.GeoPoint
import com.trippilot.placedata.domain.RegionGeocodePort
import org.springframework.stereotype.Component

/**
 * 지오코딩 스텁(기본 모드) — 실 벤더 없이도 국내 판정이 돌아야 로컬·CI 가 외부에 묶이지 않는다.
 * CI 게이트 정책이 "외부 API 호출 0회"이므로 여기가 기본이다.
 *
 * 시드는 **국내로 판정돼야 하는 것만** 담는다. 없는 이름은 빈 목록 → 국외 판정이 된다.
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
        )
    }
}
