package com.trippilot.placedata.application

import com.trippilot.placedata.api.PoiSnapshotFacade
import com.trippilot.placedata.api.PoiSnapshotRef
import com.trippilot.placedata.domain.DataStatus
import com.trippilot.placedata.domain.PoiRepository
import com.trippilot.placedata.domain.PoiSnapshot
import com.trippilot.placedata.domain.PoiSnapshotRepository
import org.springframework.stereotype.Service
import java.time.Clock
import java.util.UUID

/**
 * [PoiSnapshotFacade] 구현 — ACTIVE POI 값을 스냅숏으로 동결(INV-U1-03). trip(must_visit)·itinerary가 소비.
 */
@Service
class PoiSnapshotService(
    private val pois: PoiRepository,
    private val snapshots: PoiSnapshotRepository,
    private val clock: Clock,
) : PoiSnapshotFacade {
    override fun freeze(poiId: UUID): PoiSnapshotRef? {
        val poi = pois.findById(poiId)?.takeIf { it.dataStatus == DataStatus.ACTIVE } ?: return null
        val snap = snapshots.save(PoiSnapshot.freeze(poi, clock.instant()))
        return PoiSnapshotRef(snap.poiSnapshotId, snap.sourcePoiId, snap.nameKo, snap.lat, snap.lng, snap.category.name)
    }
}
