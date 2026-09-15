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
     * 그 코드가 **목적지로 쓸 수 있는** 행정구역인가(TRIP-859 계약 전환).
     *
     * 이름 조회와 방향이 반대다 — 이름은 여럿으로 갈리지만 코드는 하나를 가리킨다. 클라이언트가
     * 코드를 명시하면 동명이지역 문제가 애초에 생기지 않는다.
     *
     * `selectable=false`(도·일반시의 행정구)는 **false 다.** 그 행은 묶음 표시용이라 목적지가 될 수
     * 없는데, 통과시키면 화면에서 못 고르는 값이 API 로는 들어온다.
     */
    fun isSelectableCode(regionCode: String): Boolean

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

    /**
     * 코드로 찾는 대표 좌표 — **동명이지역이 애초에 생기지 않는다**(TRIP-859 후속).
     *
     * [centerOf] 는 이름으로 찾아 동명이지역이면 **첫 코드를 임의로 집는다**. 부산 중구를 고른
     * 사용자에게 서울 중구 좌표가 앵커로 박힐 수 있고, 증상은 "일정이 다른 동네에서 돈다"라
     * 원인이 안 보인다. 코드가 있으면 그 애매함이 없으므로 이쪽을 먼저 쓴다.
     *
     * 없으면 `null` — 코드가 카탈로그에 없거나 좌표가 없는 지역이다. **지어내지 않는다.**
     */
    fun centerOfCode(regionCode: String): RegionCenter?
}

/** 지역 대표 좌표(api-safe). */
data class RegionCenter(val lat: Double, val lng: Double)
