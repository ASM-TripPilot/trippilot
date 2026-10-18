package com.trippilot.accommodationsearch.domain

import com.trippilot.accommodationsearch.api.TRIPCOM_STAY_SOURCE

/**
 * 큐레이션 숙소 — 트립닷컴 제휴 Promotion Center 의 도시별 인기 목록 한 칸.
 *
 * 정본 [Stay] 와 출처가 다르다: 이쪽은 트립닷컴이 고른 소수라 **사진과 OTA 호텔 ID 가 있고**
 * 좌표·편의시설은 없다. 경계 키는 같은 합성 규약([key] → `"TRIPCOM:{hotelId}"`)이라
 * 아웃바운드가 그대로 받는다. 평점·가격은 담지 않는다(BR-U1-18 · INV-U1-05).
 */
data class CuratedStay(
    val city: String,
    val rank: Int,
    val tripcomHotelId: String,
    val name: String,
    val address: String?,  // null = 모름
    val imageUrl: String,
) {
    /** 합성 키 — 출처는 트립닷컴, 식별자는 트립닷컴 호텔 ID 다. */
    fun key(): StayKey = StayKey(TRIPCOM_STAY_SOURCE, tripcomHotelId)
}

/** 큐레이션 숙소 조회 포트. 반복 시드가 채운 테이블을 읽기만 한다. */
interface CuratedStayPort {
    /** 도시의 목록, 순위 오름차순. 모르는 도시면 빈 목록 — 404 가 아니다(목록이 아직 없을 뿐). */
    fun byCity(city: String): List<CuratedStay>

    fun findByHotelId(hotelId: String): CuratedStay?
}
