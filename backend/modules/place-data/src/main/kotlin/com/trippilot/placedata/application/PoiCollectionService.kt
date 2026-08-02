package com.trippilot.placedata.application

import com.trippilot.placedata.domain.Area
import com.trippilot.placedata.domain.MapPlacePort
import com.trippilot.placedata.domain.PoiCategory
import com.trippilot.placedata.domain.PoiCollectionGate
import com.trippilot.placedata.domain.PoiRepository
import org.springframework.stereotype.Service
import java.time.Clock

/**
 * POI 수집(C7) — 지도 API 검색 → 어댑터 정규화 → **수집 게이트(INV-1)** → ACTIVE만 저장.
 * 게이트 미통과(좌표·이름·카테고리 미확보)는 배제돼 후보풀에 들어가지 않는다.
 * 수집 트리거는 배치/관리자 소관(기동 시 자동 수집 안 함 — 최소 컨텍스트 테스트 보호).
 */
@Service
class PoiCollectionService(
    private val repo: PoiRepository,
    private val mapPlace: MapPlacePort,
    private val clock: Clock,
) {
    /** 지역 수집. 게이트 통과해 저장된 POI 수 반환. */
    fun collect(area: Area, category: PoiCategory? = null): Int {
        val now = clock.instant()
        val promoted = mapPlace.search(area, category).mapNotNull { PoiCollectionGate.promote(it, now) }
        repo.saveAll(promoted)
        return promoted.size
    }
}
