package com.trippilot.accommodationsearch.domain

import com.trippilot.core.error.FieldError
import com.trippilot.core.error.ValidationFailed

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
data class StayKey(val externalSource: String, val externalId: String) {
    companion object {
        /**
         * `"{source}:{externalId}"` 합성 문자열 → [StayKey]. 합성 규약의 소유자는 이 타입이다 —
         * 상세(StayDetailService)와 이름 조회 퍼사드(StayLookupService)가 같은 규약을 쓴다.
         *
         * **합성 문자열인 이유**: `stay` 의 PK 가 복합키(`external_source`,`external_id`)라 경로에
         * 그대로 못 넣는다. 대리 UUID 를 새로 주는 안은 기각했다 — 시드를 재생성할 때마다 값이
         * 흔들리고, 목록 응답이 이미 두 필드를 따로 실어 클라이언트가 조립만 하면 된다.
         *
         * **첫 콜론으로만 가른다.** 출처 코드에는 콜론이 없고(`LOCALDATA`·`STUB`), 식별자 쪽에
         * 콜론이 섞이더라도 뒤쪽은 통째로 식별자가 되는 것이 맞다.
         */
        fun parse(stayId: String): StayKey {
            val source = stayId.substringBefore(':', missingDelimiterValue = "")
            val externalId = stayId.substringAfter(':', missingDelimiterValue = "")
            if (source.isBlank() || externalId.isBlank()) {
                // 400 으로 올린다 — 404 로 접으면 "형식이 틀렸다"와 "그런 숙소가 없다"가 같은 응답이
                // 되어, 클라이언트가 조립을 잘못하고 있어도 영영 모른다.
                throw ValidationFailed(
                    listOf(FieldError("stayId", "숙소 식별자는 \"{출처}:{식별자}\" 형식입니다.")),
                )
            }
            return StayKey(source, externalId)
        }
    }
}

/** 표시용 금액. 최저가 스냅숏('부터 가격'). 정확 1박가는 저장하지 않는다(캐싱 금지). */
data class Money(val amount: Long, val currency: String = "KRW")
