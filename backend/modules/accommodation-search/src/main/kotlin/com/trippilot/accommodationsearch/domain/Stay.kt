package com.trippilot.accommodationsearch.domain

/**
 * 외부 숙소(앱 비소유). 정적 콘텐츠 — 이름·좌표·지역·편의시설·유형.
 * 가격은 조회 시점에 최저가 스냅숏에서 결합한다(INV-U1-05 — Stay 자체엔 가격 없음).
 */
data class Stay(
    val externalSource: String,
    val externalId: String,
    val name: String,
    val lat: Double,
    val lng: Double,
    val region: String,
    val amenities: Set<String>,   // 주차·조식·와이파이·오션뷰 …
    val stayType: String,         // 호텔·게스트하우스·펜션·리조트
) {
    fun key(): StayKey = StayKey(externalSource, externalId)
}

/** 외부 숙소 식별 키(공급자 + 공급자 내 ID). 최저가 스냅숏과 결합용. */
data class StayKey(val externalSource: String, val externalId: String)

/** 표시용 금액. 최저가 스냅숏('부터 가격'). 정확 1박가는 저장하지 않는다(캐싱 금지). */
data class Money(val amount: Long, val currency: String = "KRW")
