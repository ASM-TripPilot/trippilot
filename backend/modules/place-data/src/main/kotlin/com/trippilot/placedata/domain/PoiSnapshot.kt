package com.trippilot.placedata.domain

import java.time.Instant
import java.util.UUID

/**
 * POI 동결 스냅숏(C7) — 확정 시점(must_visit·일정 편입)의 POI 값을 **복사**(참조 아님).
 * INV-U1-03: 원본 POI가 폐업·삭제돼도 유지(source_poi_id FK 미강제).
 */
class PoiSnapshot private constructor(
    val poiSnapshotId: UUID,
    val sourcePoiId: UUID,
    val nameKo: String,
    val lat: Double,
    val lng: Double,
    val category: PoiCategory,
    val snapshotAt: Instant,
) {
    companion object {
        /** 현재 POI 값을 동결. */
        fun freeze(poi: Poi, now: Instant): PoiSnapshot =
            PoiSnapshot(UUID.randomUUID(), poi.poiId, poi.nameKo, poi.lat, poi.lng, poi.category, now)

        fun reconstitute(
            poiSnapshotId: UUID, sourcePoiId: UUID, nameKo: String, lat: Double, lng: Double,
            category: PoiCategory, snapshotAt: Instant,
        ): PoiSnapshot = PoiSnapshot(poiSnapshotId, sourcePoiId, nameKo, lat, lng, category, snapshotAt)
    }
}

/** 스냅숏 영속 포트. */
interface PoiSnapshotRepository {
    fun save(snapshot: PoiSnapshot): PoiSnapshot
    fun findById(poiSnapshotId: UUID): PoiSnapshot?

    /** 일괄 조회 — 일정 슬롯 N개의 동결 표면을 한 번에(슬롯마다 왕복하지 않게). */
    fun findByIds(poiSnapshotIds: Collection<UUID>): List<PoiSnapshot>
}
