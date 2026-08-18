package com.trippilot.placedata

import com.trippilot.placedata.domain.Region
import com.trippilot.placedata.domain.RegionCatalogPort
import com.trippilot.placedata.domain.RegionLevel

/**
 * 카탈로그 대역 — 실 시드(300행) 대신 판정에 필요한 몇 곳만.
 *
 * 골라 담은 기준: **모호한 이름**(`동구` 가 부산·대구에 겹친다) · **행정구**(수원시 장안구는 목적지가 아니다) ·
 * **단층제**(세종은 시군구가 없다). 나머지는 이 셋의 반복이라 더 담아도 새로 드러나는 것이 없다.
 */
object FakeRegionCatalog : RegionCatalogPort {

    private fun sido(code: String, name: String, selectable: Boolean) =
        Region(code, name, code, name, RegionLevel.SIDO, selectable, 0)

    private fun sigungu(code: String, name: String, sidoName: String, selectable: Boolean = true) =
        Region(code, name, code.take(2), sidoName, RegionLevel.SIGUNGU, selectable, 0)

    val rows: List<Region> = listOf(
        sido("11", "서울특별시", true),
        sigungu("11470", "양천구", "서울특별시"),
        sido("26", "부산광역시", true),
        sigungu("26170", "동구", "부산광역시"),
        sido("27", "대구광역시", true),
        sigungu("27140", "동구", "대구광역시"),
        sido("36", "세종특별자치시", true),
        sido("41", "경기도", false),
        sigungu("41110", "수원시", "경기도"),
        sigungu("41111", "수원시 장안구", "경기도", selectable = false),
        sido("50", "제주특별자치도", true),
        sigungu("50110", "제주시", "제주특별자치도"),
    )

    override fun find(query: String?, level: RegionLevel?): List<Region> = rows
}
