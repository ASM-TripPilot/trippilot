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

    /**
     * 지역 코드가 속한 도시의 목록 — 화면은 카탈로그 코드만 갖고 있어 도시 이름(`'부산'`)을 모른다.
     * 시군구·행정구 코드도 그 도시로 잡힌다(`50130` 서귀포 → 제주, `52111` 전주 완산구 → 전주).
     * 도(道) 코드처럼 한 도시로 좁혀지지 않으면 빈 목록이다.
     */
    fun byRegionCode(regionCode: String): List<CuratedStay>

    fun findByHotelId(hotelId: String): CuratedStay?
}
