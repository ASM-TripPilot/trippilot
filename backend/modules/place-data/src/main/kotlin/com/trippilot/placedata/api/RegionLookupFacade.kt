package com.trippilot.placedata.api

/**
 * 지역명 → 행정구역 표준코드 조회(C7 api-safe).
 *
 * 다른 모듈이 "이 지역명이 가리키는 코드"가 필요할 때 쓴다. 카탈로그는 place-data 소유라
 * 남의 모듈이 `RegionCatalogPort`(domain)를 직접 잡으면 경계(R1)가 깨진다.
 *
 * **여러 개를 돌려준다.** 고성군이 경남·강원에 둘 있고 '광주'는 옛 광주 자치구 5곳과 경기도 광주시를
 * 함께 가리킨다 — 하나를 고르면 거짓이 된다. 소비측이 전부를 대상으로 삼는다.
 */
interface RegionLookupFacade {
    /** 이름 또는 별칭 정확 일치. 없으면 빈 목록. */
    fun codesOf(regionName: String): List<String>

    /**
     * 지역 대표 좌표 — **숙소가 없는 날의 앵커**로 쓴다(TRIP-384).
     *
     * 우리가 가진 숙소·POI 의 무게중심이다(`R__update_region_center.sql`). 행정 경계의 기하 중심이
     * 아니라 **사람이 실제로 가는 곳**의 중심이라 여행 앵커로 더 낫다 — 경계 중심은 산·바다일 수 있다.
     *
     * 동명이지역이면 첫 코드를 쓴다. 앵커는 거친 기준점이라 그 차이가 일정 품질을 가르지 않는다.
     * 없으면 null — 지어낸 좌표를 주지 않는다.
     */
    fun centerOf(regionName: String): RegionCenter?
}

/** 지역 대표 좌표(api-safe). */
data class RegionCenter(val lat: Double, val lng: Double)
