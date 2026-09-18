package com.trippilot.placedata.api

import java.util.UUID

/**
 * RAG 후보풀(§3.4) — place-data(C7)의 공개 계약(R1, `..api..`). C8 일정생성이 소비.
 * **INV-1 소유 표면**: resolve/ground 결과는 실재 확인된 ACTIVE POI(closed-set)만. api-safe 타입만 노출.
 */
interface CandidatePoolPort {
    /** 지역 또는 반경 + 카테고리로 후보 조회. categories 비면 전 카테고리. */
    fun resolve(area: Area, categories: Set<String>): List<GroundedPlace>

    /** 주어진 POI id 중 ACTIVE만 그라운딩(미확인·폐업 제외 = INV-1). */
    fun ground(poiIds: List<UUID>): List<GroundedPlace>
}

/** 그라운딩된 후보 — 실재 확인(ACTIVE)만. distanceM은 반경 검색 시 중심 기준 거리(INV-3: 소요시간 아님·거리 OK). */
data class GroundedPlace(
    val poiId: UUID,
    val nameKo: String,
    val lat: Double,
    val lng: Double,
    val category: String,
    val region: String?,
    val distanceM: Double?,
)

/** 후보 조회 범위 — 지역명 또는 (중심, 반경m). */
sealed interface Area {
    data class Region(val region: String) : Area
    data class Radius(val centerLat: Double, val centerLng: Double, val radiusM: Double) : Area
}
