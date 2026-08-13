package com.trippilot.placedata.domain

/**
 * 지도·장소 검색 포트(C7 `PlaceLookupPort`) — 사용자가 친 문자열로 **실제 장소를 찾는다**.
 *
 * [RegionGeocodePort] 와 목적이 다르다. 저쪽은 "이 지역이 대한민국인가"를 판정하고,
 * 여기는 "사용자가 말한 그 숙소가 어디인가"를 찾는다. 그래서 **여기서는 키워드(상호) 검색을 쓴다** —
 * `제주신라호텔` 은 주소검색으로 0건이고 키워드검색으로만 잡힌다.
 *
 * **저쪽에서 키워드 검색을 뺀 이유를 여기에 적용하지 마라.** 국적 판정에서 키워드가 위험했던 것은
 * `도쿄` 가 "도쿄쿠루미(서울 마포)"에 걸려 **해외를 국내로 오판**했기 때문이다(실측).
 * 장소를 찾는 목적에서는 그 매칭이 오히려 정답이다 — 사용자는 상호를 치고 있다.
 * 판정에 쓰지 않는 한 키워드 검색은 옳다.
 */
interface PlaceLookupPort {
    /** 이름·주소 어느 쪽으로 쳐도 찾는다. 없으면 빈 목록. 조회 실패는 예외로 올린다. */
    fun search(query: String): List<PlaceLocation>
}

/** 검색 결과 한 건. 사용자가 후보 중 고르므로 좌표만이 아니라 이름·주소가 함께 필요하다. */
data class PlaceLocation(
    val name: String,
    val address: String,
    val lat: Double,
    val lng: Double,
)
