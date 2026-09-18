package com.trippilot.placedata.domain

/**
 * 지역명 → 좌표 조회 포트(카카오 로컬 주소검색).
 *
 * **키워드 검색은 쓰지 않는다.** 폴백으로 붙였다가 실호출에서 뚫렸다 — 해외 도시명이 국내 상호에 흔해서
 * `도쿄`→"도쿄쿠루미(서울 마포)" · `파리`→"파리문화공원(서울 양천)" · `오사카`→"오사카(부산 사하)" 로
 * 전부 국내 좌표가 잡혔다(실측). 목적지 판정에는 **행정구역 주소만** 본다.
 */
interface RegionGeocodePort {
    /** 행정구역 주소 검색. 없으면 빈 목록. */
    fun searchAddress(query: String): List<GeoPoint>
}

data class GeoPoint(val lat: Double, val lng: Double)

/**
 * 국내 여부 판정 결과.
 *
 * [UNKNOWN] 이 이 타입의 핵심이다 — 외부를 못 불렀을 때 "국내가 아니다"로 접으면 **장애가 곧 차단**이 되고,
 * "국내다"로 접으면 사용자는 검증된 줄 안다. 확인하지 못했다는 사실 자체를 값으로 들고 다녀야
 * 화면이 그렇게 말할 수 있다(INV-4 침묵 금지).
 */
enum class DomesticVerdict { DOMESTIC, FOREIGN, UNKNOWN }

/**
 * 국내강제 판정(INV-U1-12 · BR-U1-35) — 목적지가 대한민국 안인지.
 *
 * 왜 좌표로 보나: 이전 구현은 지역명 28개와 문자열 일치를 봤다. `천안`·`순천`·`거제`·`속초시`·
 * `제주특별자치도` 가 전부 막혔다(실측) — 국내 사용자가 정상 지역명을 넣고 여행을 못 만들었다.
 *
 * **판정**: 행정구역 주소검색 결과가 있으면 국내, 0건이면 국외.
 * 정본이 `region` 을 **시·군·구**로 정의하므로(§2 "부산"·"경주"·"사하구") 주소검색으로 충분하다 —
 * 시·군·구 10종이 전부 1건, 해외 도시 5종이 전부 0건으로 갈렸다(실측).
 * 좌표 영역 검사는 2차 방어로 둔다 — 벤더 DB 가 넓어져도 불변식은 지켜야 한다.
 */
object RegionLocator {

    /**
     * 대한민국 영역 대략 상자. 마라도(33.06)~독도(37.24/131.87)~접경(38.61) 을 포함하되
     * 인접국 본토는 배제하는 범위다. **정밀 폴리곤이 아니다** — 1차 판정은 벤더 DB 가 하고
     * 이 상자는 명백한 이탈만 거른다.
     */
    private const val LAT_MIN = 32.9
    private const val LAT_MAX = 38.7
    private const val LNG_MIN = 124.5
    private const val LNG_MAX = 132.0

    fun isInKorea(point: GeoPoint): Boolean =
        point.lat in LAT_MIN..LAT_MAX && point.lng in LNG_MIN..LNG_MAX

    /**
     * 지역명 하나를 판정한다. **조회 실패를 여기서 삼키지 않는다** — 예외를 그대로 올려
     * 호출측이 원인과 함께 기록하고 "확인 못 함"으로 다루게 한다. 여기서 접으면 왜 못 물어봤는지가 사라진다.
     */
    fun verdict(query: String, geocode: RegionGeocodePort): DomesticVerdict {
        val found = geocode.searchAddress(query)
        val first = found.firstOrNull() ?: return DomesticVerdict.FOREIGN
        return if (isInKorea(first)) DomesticVerdict.DOMESTIC else DomesticVerdict.FOREIGN
    }
}
