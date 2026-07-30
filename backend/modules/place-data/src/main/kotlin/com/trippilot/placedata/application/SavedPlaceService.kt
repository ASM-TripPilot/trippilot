package com.trippilot.placedata.application

import com.trippilot.core.error.ConflictDetected
import com.trippilot.core.error.ResourceNotFound
import com.trippilot.placedata.domain.DataStatus
import com.trippilot.placedata.domain.Poi
import com.trippilot.placedata.domain.PoiRepository
import com.trippilot.placedata.domain.SavedPlace
import com.trippilot.placedata.domain.SavedPlaceRepository
import org.springframework.stereotype.Service
import java.time.Clock
import java.util.UUID

/** 담은 장소 + 그 POI 정보(목록 표시용). */
data class SavedPlaceView(val savedPlace: SavedPlace, val poi: Poi)

/**
 * 담기(C7) — POI 북마크. 소유 스코프(타 계정 404, BR-U1-56) · (account,poi) 유일(INV-U1-04) · ACTIVE POI만.
 */
@Service
class SavedPlaceService(
    private val saved: SavedPlaceRepository,
    private val pois: PoiRepository,
    private val clock: Clock,
) {
    fun save(accountId: UUID, poiId: UUID): SavedPlaceView {
        // 담기 대상은 실재 확인된 ACTIVE POI만(INV-1). 없거나 비-ACTIVE면 404.
        val poi = pois.findById(poiId)?.takeIf { it.dataStatus == DataStatus.ACTIVE } ?: throw ResourceNotFound()
        if (saved.existsByAccountAndPoi(accountId, poiId)) {
            throw ConflictDetected(message = "이미 담은 장소입니다.")
        }
        val sp = saved.save(SavedPlace.create(accountId, poiId, clock.instant()))
        return SavedPlaceView(sp, poi)
    }

    fun list(accountId: UUID): List<SavedPlaceView> {
        val sps = saved.findByAccount(accountId)
        val poiById = pois.findActiveByIds(sps.map { it.poiId }).associateBy { it.poiId }
        return sps.mapNotNull { sp -> poiById[sp.poiId]?.let { SavedPlaceView(sp, it) } }
    }

    fun remove(accountId: UUID, savedPlaceId: UUID) {
        val sp = saved.findById(savedPlaceId)?.takeIf { it.accountId == accountId } ?: throw ResourceNotFound()
        saved.delete(sp)
    }
}
