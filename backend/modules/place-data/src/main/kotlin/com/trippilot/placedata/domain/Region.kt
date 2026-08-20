package com.trippilot.placedata.domain

/**
 * 행정구역 카탈로그의 한 행(V2.24 · TRIP-357).
 *
 * 목적지 선택의 정본이다. 이전에는 지역명이 자유 문자열이라 표기가 흔들렸고(`제주`·`제주도`·`제주특별자치도`),
 * 고를 수 있는 목록이 프론트·백엔드에 따로 하드코딩돼 갈라졌다.
 *
 * [poiCount] 는 커버리지 — 0인 지역을 고르면 후보풀이 비어 일정이 조용히 빈다(INV-1·INV-4).
 * 화면이 "준비 중"을 그릴 수 있도록 값으로 내보낸다. 채우는 것은 TRIP-359 소관이라 그 전까지는 0이다.
 */
data class Region(
    val regionCode: String,
    val name: String,
    val sidoCode: String,
    val sidoName: String,
    val level: RegionLevel,
    val selectable: Boolean,
    val poiCount: Int,
    /**
     * 대표 좌표 — 숙소가 없는 날의 앵커(TRIP-384). 우리가 가진 숙소·POI 의 무게중심이라
     * 데이터가 한 건도 없는 지역은 null 이다. **지어내지 않는다.**
     */
    val lat: Double? = null,
    val lng: Double? = null,
)

/** 카탈로그의 층. 시도 2자리 · 시군구 5자리(법정동코드 앞자리). */
enum class RegionLevel { SIDO, SIGUNGU }

/**
 * 지역 하나의 커버리지 — **그 코드로 시작하는 모든 POI**의 수.
 *
 * 시도 코드(2자리)는 그 안 시군구 코드(5자리)의 접두사다. 시도를 목적지로 고르면 그 안의 시군구 POI 가
 * 전부 후보풀이 되므로 접두사 합이 곧 롤업이다 — 제주(50)를 고른 사람에게 제주시·서귀포시가 다 보이는 게 맞다.
 *
 * **저장하지 않고 조회 때마다 센다.** 저장하면 POI 를 쓰는 경로를 하나만 빠뜨려도 아무도 실패하지 않고,
 * 화면은 커버리지가 있는 지역을 계속 "준비 중"으로 그린다(INV-4 침묵 실패 금지).
 */
fun coverageOf(regionCode: String, activeCountsByCode: Map<String, Int>): Int =
    activeCountsByCode.entries.sumOf { (code, n) -> if (code.startsWith(regionCode)) n else 0 }

/**
 * 카탈로그 조회 포트.
 *
 * **별칭도 같이 본다.** 광주광역시·전라남도가 폐지·통합돼 표준명만 두면 사용자가 익숙한 이름으로
 * 검색해도 아무것도 안 잡힌다(TRIP-357).
 */
interface RegionCatalogPort {
    /**
     * @param query 이름 또는 별칭 부분일치. null·공백이면 필터하지 않는다
     * @param level 층 필터. null 이면 전부
     */
    fun find(query: String?, level: RegionLevel?): List<Region>

    /**
     * 이름 또는 별칭 **정확 일치**. 없으면 빈 목록.
     *
     * [find] 의 부분일치를 검증에 쓰면 안 된다 — `천` 하나로 천안시가 잡혀 아무 글자나 통과한다.
     * 동명이지역이 있어 여러 건일 수 있다(고성군이 경남·강원에 둘 있다) — 하나를 고르지 않고 그대로 준다.
     */
    fun findExact(name: String): List<Region>
}
