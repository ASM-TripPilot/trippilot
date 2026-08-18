package com.trippilot.placedata.application

import com.trippilot.placedata.domain.Region
import com.trippilot.placedata.domain.RegionCatalogPort
import com.trippilot.placedata.domain.RegionLevel
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional

/**
 * 행정구역 카탈로그 조회(TRIP-358).
 *
 * 판정 로직이 없다 — 카탈로그는 시드가 정본이고 여기서 걸러 넣을 규칙이 없기 때문이다.
 * `selectable` 을 서버에서 잘라 내보내지 **않는** 이유는 컨트롤러 주석에 적었다.
 */
@Service
@Transactional(readOnly = true)
class RegionCatalogService(
    private val catalog: RegionCatalogPort,
) {
    fun search(query: String?, level: RegionLevel?): List<Region> = catalog.find(query, level)
}
