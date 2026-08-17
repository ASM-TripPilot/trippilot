package com.trippilot.placedata.domain

import java.util.UUID

/**
 * 벤더 응답을 표준 스키마로 정규화한 수집 후보(게이트 입력). 벤더 비종속.
 * 좌표·카테고리는 미확보 가능(원시 데이터 불완전) → 게이트가 판정.
 */
data class NormalizedPlace(
    val nameKo: String,
    val lat: Double?,
    val lng: Double?,
    val category: PoiCategory?,
    val region: String?,
    val openingHours: String?,
    val source: PoiSource,
    /**
     * 출처가 준 원본 식별자(TourAPI contentId 등). 벤더가 안 주면 null —
     * **지어내지 않는다.** null 이면 멱등 판정 대상이 아니라 매번 새 행이 된다.
     */
    val sourceRef: String? = null,
)

/** 조회 지역 범위. 반경/bounding-box 프리필터는 후보풀(CandidatePoolPort, TRIP-213)에서. */
data class Area(val region: String)

/** POI 정본 영속 포트. 조회는 ACTIVE만(INV-U1-01) — 리포지토리가 집행. */
interface PoiRepository {
    fun saveAll(pois: List<Poi>): List<Poi>
    fun findById(poiId: UUID): Poi?
    fun findActive(region: String?, category: PoiCategory?): List<Poi>

    /** 반경 검색 프리필터 — bounding-box 내 ACTIVE. 정밀 반경 컷은 서비스(하버사인). */
    fun findActiveInBounds(latMin: Double, latMax: Double, lngMin: Double, lngMax: Double): List<Poi>

    /** 주어진 id 중 ACTIVE만(ground용 — 미확인·폐업 제외). */
    fun findActiveByIds(poiIds: List<UUID>): List<Poi>

    /** 주어진 id 전부(상태 무관 — 담기 목록 표시용, 폐업·미검증도 상태와 함께 노출). */
    fun findByIds(poiIds: List<UUID>): List<Poi>

    /**
     * 같은 출처의 원본 식별자로 이미 아는 POI 를 찾는다 — 수집 재실행이 행을 늘리지 않게 하는 판정용.
     * 키는 `sourceRef`, 값은 그 POI. 못 찾은 ref 는 키 자체가 없다(빈 값으로 채우지 않는다).
     */
    fun findBySourceRefs(source: PoiSource, sourceRefs: Collection<String>): Map<String, Poi>
}

/**
 * 지도/장소 API 포트("1 외부API = 1 어댑터 포트"). 벤더 어댑터가 각자 정규화해 [NormalizedPlace] 반환.
 * 약관: 캐싱 금지·실시간·출처 표기(1차는 스텁). 실패 시 폴백(ADR-0011)은 어댑터.
 */
interface MapPlacePort {
    fun search(area: Area, category: PoiCategory?): List<NormalizedPlace>
}
