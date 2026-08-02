package com.trippilot.placedata.api

import java.util.UUID

/**
 * POI 스냅숏 동결 퍼사드 — place-data(C7)의 공개 계약(R1). trip(must_visit)·itinerary가 소비.
 * 확정 시 POI 값을 복사·저장하고 참조 id를 반환(INV-U1-03). api-safe 타입만.
 */
interface PoiSnapshotFacade {
    /** ACTIVE POI를 스냅숏으로 동결. 없거나 비-ACTIVE면 null(호출측 404/400 매핑). */
    fun freeze(poiId: UUID): PoiSnapshotRef?
}

/** 동결된 스냅숏 참조 — must_visit이 poi_snapshot_id로 FK. category는 api-safe(String). */
data class PoiSnapshotRef(
    val poiSnapshotId: UUID,
    val sourcePoiId: UUID,
    val nameKo: String,
    val lat: Double,
    val lng: Double,
    val category: String,
)
