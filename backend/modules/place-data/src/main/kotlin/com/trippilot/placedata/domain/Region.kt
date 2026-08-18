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
)

/** 카탈로그의 층. 시도 2자리 · 시군구 5자리(법정동코드 앞자리). */
enum class RegionLevel { SIDO, SIGUNGU }

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
}
