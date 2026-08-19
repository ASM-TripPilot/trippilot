package com.trippilot.accommodationsearch.domain

/**
 * 숙소 탐색 조건. 날짜·인원 없이 탐색 가능(BR-U1-10).
 * amenities/stayTypes 필터는 AND 매칭. 정렬은 최저가순 고정(BR-U1-15) — 조건 없음.
 *
 * [nearby] 는 '내 주변' 좌표 스코프(TRIP-202). region 과 AND 로 걸리고, **필터가 아니라
 * 스코프**라 [hasFilter] 에 포함되지 않는다 — filter-zero 완화 제안 대상이 아니다.
 */
data class StaySearchQuery(
    val region: String? = null,
    val amenities: Set<String> = emptySet(),
    val stayTypes: Set<String> = emptySet(),
    val nearby: Nearby? = null,
) {
    val hasFilter: Boolean get() = amenities.isNotEmpty() || stayTypes.isNotEmpty()
}

/** 탐색 결과 항목: 숙소 + 최저가(없으면 null = '가격 미확인', BR-U1-14). */
data class StayResult(val stay: Stay, val lowestPrice: Money?)

/**
 * 탐색 결과 집합.
 * - items: 최저가순 정렬(가격 미확인 항목은 맨 뒤).
 * - degraded: 일부 공급자 실패(BR-U1-17) — true면 부분 결과 + 재시도 안내 대상.
 * - filterZeroReasons: 필터 때문에 0건이 된 경우 원인 필터(BR-U1-16). 비어있지 않으면 완화 제안.
 */
data class StaySearch(
    val items: List<StayResult>,
    val degraded: Boolean,
    val filterZeroReasons: List<String>,
    /**
     * 편의시설 정보를 **가지고 있는가**.
     *
     * false 면 "편의시설이 없는 숙소들"이 아니라 **아직 모른다**는 뜻이다. 현재 정본(LOCALDATA
     * 인허가 대장)은 편의시설을 주지 않는다. 이 값을 안 내보내면 사용자가 '주차' 필터를 걸었을 때
     * 0건이 "주차 되는 숙소가 없다"로 읽히고, 화면은 있지도 않은 필터를 계속 권한다(INV-4).
     */
    val amenitiesKnown: Boolean,
)
