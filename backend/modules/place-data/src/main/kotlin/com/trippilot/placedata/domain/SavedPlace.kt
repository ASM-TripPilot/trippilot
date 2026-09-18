package com.trippilot.placedata.domain

import java.time.Instant
import java.util.UUID

/**
 * 담은 장소(C7) — 사용자가 POI를 북마크. (account, poi) 유일(INV-U1-04). 앱 소유 스코프.
 * poi 참조는 라이브(정본). 확정 동결은 [PoiSnapshot](INV-U1-03)이 담당.
 */
class SavedPlace private constructor(
    val savedPlaceId: UUID,
    val accountId: UUID,
    val poiId: UUID,
    val savedAt: Instant,
) {
    companion object {
        fun create(accountId: UUID, poiId: UUID, now: Instant): SavedPlace =
            SavedPlace(UUID.randomUUID(), accountId, poiId, now)

        fun reconstitute(savedPlaceId: UUID, accountId: UUID, poiId: UUID, savedAt: Instant): SavedPlace =
            SavedPlace(savedPlaceId, accountId, poiId, savedAt)
    }
}

/** 담은 장소 영속 포트. (account, poi) 유일·소유 스코프 인가는 서비스가. */
interface SavedPlaceRepository {
    fun save(savedPlace: SavedPlace): SavedPlace
    fun findByAccount(accountId: UUID): List<SavedPlace>
    fun findById(savedPlaceId: UUID): SavedPlace?
    fun existsByAccountAndPoi(accountId: UUID, poiId: UUID): Boolean
    fun delete(savedPlace: SavedPlace)
}
