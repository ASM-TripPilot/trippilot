package com.trippilot.placedata.application

import com.trippilot.placedata.api.RegionCenter
import com.trippilot.placedata.api.RegionLookupFacade
import com.trippilot.placedata.domain.RegionCatalogPort
import com.trippilot.placedata.domain.RegionLevel
import org.springframework.stereotype.Service

/** [RegionLookupFacade] 구현 — 카탈로그 정확 일치 조회를 api-safe 타입으로 내보낸다. */
@Service
class RegionLookupService(
    private val catalog: RegionCatalogPort,
) : RegionLookupFacade {

    override fun codesOf(regionName: String): List<String> =
        catalog.findExact(regionName).map { it.regionCode }

    override fun isSelectableCode(regionCode: String): Boolean =
        catalog.findByCode(regionCode)?.selectable == true

    override fun centerOfCode(regionCode: String): RegionCenter? =
        catalog.findByCode(regionCode)?.let { r ->
            val lat = r.lat
            val lng = r.lng
            if (lat != null && lng != null) RegionCenter(lat, lng) else null
        }

    override fun districtCodesOf(regionCode: String): Set<String> {
        val region = catalog.findByCode(regionCode) ?: return emptySet()
        if (region.level != RegionLevel.SIGUNGU) return emptySet()
        if (!regionCode.endsWith("0")) return setOf(regionCode) // 하위 행정구가 붙는 일반시는 끝자리 0 이다(41110 수원시)
        val prefix = regionCode.dropLast(1)
        return catalog.find(null, RegionLevel.SIGUNGU)
            .filter { it.regionCode == regionCode || (it.regionCode.startsWith(prefix) && !it.selectable && it.sidoCode == region.sidoCode) }
            .mapTo(sortedSetOf()) { it.regionCode }
    }

    override fun centerOf(regionName: String): RegionCenter? =
        catalog.findExact(regionName).firstNotNullOfOrNull { r ->
            val lat = r.lat
            val lng = r.lng
            if (lat != null && lng != null) RegionCenter(lat, lng) else null
        }
}
