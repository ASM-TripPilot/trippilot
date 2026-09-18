package com.trippilot.accommodationsearch.domain

/**
 * 외부 숙소 정적 콘텐츠 조회 포트. 벤더 어댑터가 구현(1차 스텁).
 * 실 벤더 단계에서 Resilience4j 서킷·Redis 캐시가 이 포트 구현을 감싼다.
 */
interface AccommodationContentPort {
    /** 지역 기준 숙소 콘텐츠. region=null 이면 전체. 일부 벤더 실패 시 degraded=true + 가용분만. */
    fun search(region: String?): ContentResult
}

/**
 * 콘텐츠 조회 결과 — 부분 실패 표현(BR-U1-17).
 *
 * [amenitiesKnown] 은 **공급자가 편의시설을 주는가**다. 아는 쪽이 어댑터라 여기서 말한다 —
 * 서비스가 "빈 배열이면 모르는 것"이라고 추측하면, 진짜로 편의시설이 없는 숙소와 구분할 수 없다.
 */
data class ContentResult(
    val stays: List<Stay>,
    val degraded: Boolean,
    val amenitiesKnown: Boolean = true,
    /**
     * 공급자가 **상한에 걸려 일부만 돌려줬는가**.
     *
     * true 면 뒤따르는 필터가 전체가 아니라 부분집합 위에서 돈다 — "조건에 맞는 숙소가 없다"가
     * 사실이 아닐 수 있다. 조용히 자르면 그 차이가 사라진다.
     */
    val truncated: Boolean = false,
)

/**
 * 최저가 스냅숏 조회 포트. 배치가 채운 값을 읽기만(INV-U1-05 — 정확가는 여기 없음).
 * 스텁 단계엔 R__seed_stub_stay_prices.sql 이 채운다. 실 벤더 단계에 가격 배치(LC-U1-2, 쓰기측)가 붙는다.
 */
interface StayPriceQueryPort {
    fun lowestPrices(keys: List<StayKey>): Map<StayKey, Money>
}
