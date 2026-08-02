package com.trippilot.accommodationsearch.adapter.`in`.web

import com.trippilot.accommodationsearch.domain.StayResult
import com.trippilot.accommodationsearch.domain.StaySearch

/**
 * 탐색 응답. INV-3: 소요시간(duration) 필드 없음. 가격은 최저가 스냅숏뿐(정확가는 상세/딥링크 별도).
 * - degraded=true: 일부 공급자 실패 — 재시도 안내 대상(BR-U1-17).
 * - filterZeroReasons: 비어있지 않으면 그 필터가 0건 원인 → 완화 제안(BR-U1-16).
 */
data class StaySearchResponse(
    val items: List<StayItemResponse>,
    val degraded: Boolean,
    val filterZeroReasons: List<String>,
) {
    companion object {
        fun from(s: StaySearch) = StaySearchResponse(
            items = s.items.map { StayItemResponse.from(it) },
            degraded = s.degraded,
            filterZeroReasons = s.filterZeroReasons,
        )
    }
}

data class StayItemResponse(
    val externalSource: String,
    val externalId: String,
    val name: String,
    val lat: Double,
    val lng: Double,
    val region: String,
    val amenities: List<String>,
    val stayType: String,
    val price: PriceResponse?,   // null = 가격 미확인(BR-U1-14)
) {
    companion object {
        fun from(r: StayResult) = StayItemResponse(
            externalSource = r.stay.externalSource,
            externalId = r.stay.externalId,
            name = r.stay.name,
            lat = r.stay.lat,
            lng = r.stay.lng,
            region = r.stay.region,
            amenities = r.stay.amenities.sorted(),
            stayType = r.stay.stayType,
            price = r.lowestPrice?.let { PriceResponse(it.amount, it.currency) },
        )
    }
}

data class PriceResponse(val amount: Long, val currency: String)
