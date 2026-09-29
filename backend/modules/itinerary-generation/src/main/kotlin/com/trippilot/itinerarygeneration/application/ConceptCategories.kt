package com.trippilot.itinerarygeneration.application

/**
 * 같이 짜기 컨셉(h13 라벨) → POI 카테고리 매핑(TRIP-1065 · QA #042).
 *
 * '식사'를 골라도 기념탑·도서관이 오고 근거가 "식사 컨셉에 맞는 명소"(거짓)였다 — concept 이
 * AI 요청에 실리지 않고 어디서도 필터되지 않았기 때문이다(연동 설계 §9 한계 2의 '별건'이 이것).
 *
 * **매핑표는 여기 한 곳뿐이다**(결정 1 — PoiCategory 어휘를 아는 BE 소유). 값은 place-data 의
 * 한글 정본 카테고리(`GroundedPlace.category` · `PoiSurfaceView.category`)와 같은 어휘다.
 * 키는 FE `SlotFillPage` CONCEPTS 라벨 5종 — **매핑에 없는 컨셉은 400 이 아니라 필터 없음**이다
 * (reason 선례: 모르는 코드도 400 이 아니다. 자유 문자열·구버전 앱이 온다).
 */
object ConceptCategories {

    private val MAP: Map<String, Set<String>> = mapOf(
        "식사" to setOf("맛집"),
        "카페" to setOf("카페"),
        "전시·문화" to setOf("문화"),
        // '야외·산책'에 명소·야경까지 넣을지는 제품 판단 미확정(티켓 '미확인') — 확실한 자연만 건다.
        "야외·산책" to setOf("자연"),
        "쇼핑" to setOf("쇼핑"),
    )

    /** null = 필터 없음(컨셉 없음·공백·미매핑). */
    fun of(concept: String?): Set<String>? = concept?.trim()?.takeIf { it.isNotEmpty() }?.let { MAP[it] }
}
