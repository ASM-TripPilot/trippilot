package com.trippilot.itinerarygeneration.application

import com.trippilot.placedata.api.PoiSnapshotFacade
import com.trippilot.placedata.api.PoiSnapshotRef
import java.util.UUID

/**
 * 항상 동결에 성공하는 대역(TRIP-999) — 얼린 poiId 를 기록해 "새 장소만 얼렸는지"를 볼 수 있다.
 * 동결 실패 경로는 [freezeFails] 를 켜서 재현한다(null 반환 = 비-ACTIVE·소실).
 */
internal class FreezeAllSnapshots : PoiSnapshotFacade {
    val frozen = mutableListOf<UUID>()
    var freezeFails = false

    override fun freeze(poiId: UUID): PoiSnapshotRef? {
        if (freezeFails) return null
        frozen += poiId
        return PoiSnapshotRef(UUID.randomUUID(), poiId, "동결됨", 33.45, 126.56, "명소")
    }
}
