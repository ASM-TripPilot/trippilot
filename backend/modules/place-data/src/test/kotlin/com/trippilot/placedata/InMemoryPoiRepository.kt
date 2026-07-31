package com.trippilot.placedata

import com.trippilot.placedata.domain.DataStatus
import com.trippilot.placedata.domain.Poi
import com.trippilot.placedata.domain.PoiCategory
import com.trippilot.placedata.domain.PoiRepository
import java.util.UUID

/** 공유 인메모리 PoiRepository 페이크 — 수집·후보풀 테스트 공용. ACTIVE 필터는 실 쿼리와 동일 규칙. */
class InMemoryPoiRepository : PoiRepository {
    val stored = mutableListOf<Poi>()

    override fun saveAll(pois: List<Poi>) = pois.also { stored.addAll(it) }
    override fun findById(poiId: UUID) = stored.firstOrNull { it.poiId == poiId }

    override fun findActive(region: String?, category: PoiCategory?) =
        stored.filter { active(it) && (region == null || it.region == region) && (category == null || it.category == category) }

    override fun findActiveInBounds(latMin: Double, latMax: Double, lngMin: Double, lngMax: Double) =
        stored.filter { active(it) && it.lat in latMin..latMax && it.lng in lngMin..lngMax }

    override fun findActiveByIds(poiIds: List<UUID>) =
        stored.filter { active(it) && it.poiId in poiIds }

    override fun findByIds(poiIds: List<UUID>) = stored.filter { it.poiId in poiIds }

    private fun active(p: Poi) = p.dataStatus == DataStatus.ACTIVE
}
