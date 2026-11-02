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
     * 우리가 가진 숙소·POI 로 잡는다 — 시군구는 무게중심, 시도는 가장 빽빽한 곳이다
     * (`R__update_region_center.sql`). 행정 경계의 기하 중심이
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

    /**
     * 구(시군구)를 고른 여행의 "구 안" 판정에 쓸 코드 집합(2026-10-23 사용자 결정: 구를 고르면 그 구 안 우선, 모자라면 이웃 구).
     * 시군구면 그 코드 하나, 시도·카탈로그에 없는 코드면 빈 집합(= 구 단위가 아니다 — 서울을 고르면 다른 구로 가도 된다).
     *
     * **정확 일치로 충분하다** — POI 코드는 `RegionResolver`(domain) 한 곳에서 붙고 행정구(41111 장안구)는 상위 시(41110 수원시)로
     * 접혀 저장된다. 접두사로 넓히면 영동군(43740)이 증평군(43745)을 끌어온다. 규칙은 여기 한 곳이다(같이 짜기·생성 앵커 공통).
     *
     * 기본 구현은 빈 집합이다 — 지역 대역을 쓰는 테스트들이 구현하지 않아도 되게(빈 집합 = 종전 동작).
     */
    fun districtCodesOf(regionCode: String): Set<String> = emptySet()

    /**
     * 주소 → 행정구역 코드(시군구 5자리 또는 시도 2자리) — POI 에 코드를 붙이는 규칙(`RegionResolver`) 그대로다(TRIP-1703 거점 지역 판정).
     * 못 정하면 null — 가까운 지역으로 밀어 넣지 않는다. 기본 구현 null = 판정 불가(지역 대역 테스트용, 소비측은 fail-open).
     */
    fun codeOfAddress(address: String): String? = null

    /** 코드 → 사람이 읽는 이름(시도 `부산광역시` · 시군구 `부산광역시 동구`). 카탈로그에 없으면 null(TRIP-1706 회고 서술 지역). */
    fun displayNameOfCode(regionCode: String): String? = null
}

/** 지역 대표 좌표(api-safe). */
data class RegionCenter(val lat: Double, val lng: Double)
