package com.trippilot.placedata.application

import com.trippilot.placedata.api.RegionLookupFacade
import com.trippilot.placedata.domain.RegionCatalogPort
import org.springframework.stereotype.Service

/** [RegionLookupFacade] 구현 — 카탈로그 정확 일치 조회를 api-safe 타입으로 내보낸다. */
@Service
class RegionLookupService(
    private val catalog: RegionCatalogPort,
) : RegionLookupFacade {

    override fun codesOf(regionName: String): List<String> =
        catalog.findExact(regionName).map { it.regionCode }
}
