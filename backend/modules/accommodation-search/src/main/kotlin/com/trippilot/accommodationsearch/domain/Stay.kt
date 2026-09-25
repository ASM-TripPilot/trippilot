package com.trippilot.accommodationsearch.domain

/**
 * 외부 숙소(앱 비소유). 정적 콘텐츠 — 이름·좌표·지역·주소·전화·객실 수·편의시설·유형.
 * 가격은 조회 시점에 최저가 스냅숏에서 결합한다(INV-U1-05 — Stay 자체엔 가격 없음).
 *
 * **아래 셋은 null 이 "없음"이 아니라 "모름"이다.** 공급자마다 주는 칸이 다르다 —
 * LOCALDATA 정본 실측으로 주소 100% · 전화 54.8% · 객실 99.5% 다. 화면은 null 이면
 * 그 줄을 비우면 되고, "전화 없는 숙소"로 그리면 안 된다.
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
    val address: String? = null,  // 도로명 우선, 없으면 지번
    val phone: String? = null,    // 표시형 '02-2267-7474' — 그대로 tel: 에 실을 수 있다
    val rooms: Int? = null,       // 양실+한실 합. 0 은 저장하지 않는다(미기재와 구분 불가)
) {
    fun key(): StayKey = StayKey(externalSource, externalId)
}

/** 외부 숙소 식별 키(공급자 + 공급자 내 ID). 최저가 스냅숏과 결합용. */
data class StayKey(val externalSource: String, val externalId: String)

/** 표시용 금액. 최저가 스냅숏('부터 가격'). 정확 1박가는 저장하지 않는다(캐싱 금지). */
data class Money(val amount: Long, val currency: String = "KRW")
