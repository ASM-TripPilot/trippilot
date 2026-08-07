package com.trippilot.placedata.application

import com.trippilot.placedata.api.FrozenPoiView
import com.trippilot.placedata.api.PoiSurfaceFacade
import com.trippilot.placedata.api.PoiSurfaceView
import com.trippilot.placedata.domain.PoiRepository
import com.trippilot.placedata.domain.PoiSnapshotRepository
import org.springframework.stereotype.Service
import java.util.UUID

/** 표시용 POI 표면 합성(BR-U3-09). 일괄 조회만 — 슬롯마다 왕복하지 않는다. */
@Service
class PoiSurfaceService(
    private val pois: PoiRepository,
    private val snapshots: PoiSnapshotRepository,
) : PoiSurfaceFacade {

    override fun findSurfaces(poiIds: Collection<UUID>): Map<UUID, PoiSurfaceView> {
        if (poiIds.isEmpty()) return emptyMap()
        // 상태 무관(findByIds) — 이미 일정에 들어간 장소는 비활성이 됐어도 화면에서 사라지면 안 된다.
        return pois.findByIds(poiIds.distinct()).associate { p ->
            p.poiId to PoiSurfaceView(
                poiId = p.poiId,
                nameKo = p.nameKo,
                lat = p.lat,
                lng = p.lng,
                category = p.category.name,
                openingHours = p.openingHours,
                imageUrl = p.imageUrl,
                tags = p.tags,
            )
        }
    }

    override fun findFrozenSurfaces(poiSnapshotIds: Collection<UUID>): Map<UUID, FrozenPoiView> {
        if (poiSnapshotIds.isEmpty()) return emptyMap()
        return snapshots.findByIds(poiSnapshotIds.distinct()).associate { s ->
            s.poiSnapshotId to FrozenPoiView(s.poiSnapshotId, s.sourcePoiId, s.nameKo, s.lat, s.lng, s.category.name)
        }
    }
}
