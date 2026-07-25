package com.trippilot.accommodationsearch.domain

/**
 * 외부 숙소 정적 콘텐츠 조회 포트. 벤더 어댑터가 구현(1차 스텁).
 * 실 벤더 단계에서 Resilience4j 서킷·Redis 캐시가 이 포트 구현을 감싼다.
 */
interface AccommodationContentPort {
    /** 지역 기준 숙소 콘텐츠. region=null 이면 전체. 일부 벤더 실패 시 degraded=true + 가용분만. */
    fun search(region: String?): ContentResult
}

/** 콘텐츠 조회 결과 — 부분 실패 표현(BR-U1-17). */
data class ContentResult(val stays: List<Stay>, val degraded: Boolean)

/** 최저가 스냅숏 조회 포트. 배치가 채운 값을 읽기만(INV-U1-05 — 정확가는 여기 없음). */
interface StayPriceQueryPort {
    fun lowestPrices(keys: List<StayKey>): Map<StayKey, Money>
}

/** 최저가 스냅숏 기록 포트(PriceSnapshotBatch 가 사용). */
interface StayPriceWriterPort {
    fun upsert(key: StayKey, price: Money)
}
