package com.trippilot.placedata.adapter.`in`.web

import com.trippilot.placedata.domain.Poi
import com.trippilot.placedata.domain.PoiCategory
import java.util.UUID

/** 탐색 응답(최소) — 명·카테고리·좌표·지역·저장수. 소요시간 없음(INV-3, 거리는 후보풀에서). */
data class PlaceResponse(
    val poiId: UUID,
    val nameKo: String,
    val category: PoiCategory,
    val lat: Double,
    val lng: Double,
    val region: String?,
    val openingHours: String?,
    val savedCount: Long,
) {
    companion object {
        fun from(p: Poi) = PlaceResponse(
            poiId = p.poiId, nameKo = p.nameKo, category = p.category, lat = p.lat, lng = p.lng,
            region = p.region, openingHours = p.openingHours, savedCount = p.savedCount,
        )
    }
}
