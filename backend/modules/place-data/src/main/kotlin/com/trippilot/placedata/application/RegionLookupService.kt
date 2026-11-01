package com.trippilot.placedata.application

import com.trippilot.placedata.api.RegionCenter
import com.trippilot.placedata.api.RegionLookupFacade
import com.trippilot.placedata.domain.RegionCatalogPort
import com.trippilot.placedata.domain.RegionLevel
import com.trippilot.placedata.domain.RegionResolver
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

    // findByCode 는 커버리지(전 POI 집계)를 세지 않는다 — 후보 요청마다 불리는 자리라 find() 를 쓰지 않는다.
    override fun districtCodesOf(regionCode: String): Set<String> =
        catalog.findByCode(regionCode)?.takeIf { it.level == RegionLevel.SIGUNGU }?.let { setOf(it.regionCode) }.orEmpty()

    // ponytail: 거점 배정마다 전 카탈로그(+POI 집계 1회)를 읽는다 — 배정은 사람 손 한 번이라 감당한다. 잦은 경로에 붙이면 시도·시군구만 읽는 조회로 바꾼다.
    override fun codeOfAddress(address: String): String? = RegionResolver.resolve(address, catalog.find(null, null))

    override fun centerOf(regionName: String): RegionCenter? =
        catalog.findExact(regionName).firstNotNullOfOrNull { r ->
            val lat = r.lat
            val lng = r.lng
            if (lat != null && lng != null) RegionCenter(lat, lng) else null
        }
}
