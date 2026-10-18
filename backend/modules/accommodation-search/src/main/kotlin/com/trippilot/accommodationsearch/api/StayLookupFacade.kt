package com.trippilot.accommodationsearch.api

/**
 * 숙소 이름 조회 퍼사드(R1) — affiliate-link 가 아웃바운드 폴백 URL(`"{이름} 예약"`)을 만들 때 쓴다.
 *
 * 내부 도메인 타입(`Stay`)을 계약에 싣지 않는다. 경계 키는 합성 `stayId`(`"{출처}:{식별자}"`)
 * 그대로다 — 상세 API 가 쓰는 것과 같은 규약이라 호출측이 새 조립을 배울 필요가 없다.
 */
interface StayLookupFacade {
    /**
     * 숙소 표시 이름. **없으면 null** — 지어내지 않는다.
     * 형식이 틀리면 `ValidationFailed`(400) — 상세(`GET /stays/{stayId}`)와 같은 의미론.
     */
    fun findName(stayId: String): String?
}

/**
 * 트립닷컴 큐레이션 숙소의 합성 stayId 출처 코드 — `"TRIPCOM:{트립닷컴 호텔 ID}"`.
 * 아웃바운드 딥링크가 이 출처면 키워드 검색 대신 호텔 상세로 보낸다(식별자가 곧 hotelId).
 */
const val TRIPCOM_STAY_SOURCE = "TRIPCOM"
