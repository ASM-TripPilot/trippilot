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
    /**
     * false = 편의시설 정보를 **아직 모른다**(없는 것이 아니다). 화면은 편의시설 필터를 비활성화하거나
     * "정보 준비 중"을 안내한다 — 안 그러면 필터 0건이 "그런 숙소가 없다"로 읽힌다.
     */
    val amenitiesKnown: Boolean,
    /**
     * true = 전국이 너무 많아 **일부만** 본 결과다(지역 미선택 시). 필터가 부분집합 위에서 돌았으므로
     * "조건에 맞는 숙소가 없다"고 단정하면 안 된다 — 화면은 지역 선택을 권한다.
     */
    val truncated: Boolean,
) {
    companion object {
        fun from(s: StaySearch) = StaySearchResponse(
            items = s.items.map { StayItemResponse.from(it) },
            degraded = s.degraded,
            filterZeroReasons = s.filterZeroReasons,
            amenitiesKnown = s.amenitiesKnown,
            truncated = s.truncated,
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

/**
 * 숙소 상세(US-STAY-03). 목록 항목([StayItemResponse])에 **`stayId` 하나만** 더한다 —
 * 상세가 목록보다 풍부해지는 것은 사진·편의시설이 채워진 뒤이고(숙소콘텐츠-수집-설계.md),
 * 지금 없는 값을 자리만 만들어 두면 화면이 "준비 중"을 그릴 근거를 잃는다.
 *
 * **리뷰·평점이 없는 것은 의도다**(US-STAY-03 — 외부 OTA 위임). 정확 1박가도 없다
 * (INV-U1-05 — 캐싱 금지라 표시 시점에 따로 부른다). 소요시간도 없다(INV-3).
 */
data class StayDetailResponse(
    /** 경로에 그대로 쓰는 합성 식별자 `"{출처}:{식별자}"` — 클라이언트가 조립하지 않게 실어 준다. */
    val stayId: String,
    val externalSource: String,
    val externalId: String,
    val name: String,
    val lat: Double,
    val lng: Double,
    val region: String,
    val amenities: List<String>,
    val stayType: String,
    val price: PriceResponse?,   // null = 가격 미확인(BR-U1-14) — 상세를 막는 사유가 아니다
) {
    companion object {
        fun from(r: StayResult) = StayDetailResponse(
            stayId = "${r.stay.externalSource}:${r.stay.externalId}",
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
