package com.trippilot.placedata.application

import com.trippilot.placedata.domain.Region
import com.trippilot.placedata.domain.RegionCatalogPort
import com.trippilot.placedata.domain.RegionLevel
import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.shouldBe

/**
 * "구 안" 판정의 코드 집합(2026-10-23 — 구를 고른 여행은 그 구 안 우선).
 * POI 는 행정구를 상위 시로 접어 저장하므로(`RegionResolver` — 수원시 장안구 → 41110) 시군구 코드 하나면 된다.
 * 접두어로 넓히면 영동군 43740 이 증평군 43745 를 삼킨다.
 */
class DistrictCodesTest : StringSpec({

    fun row(code: String, level: RegionLevel = RegionLevel.SIGUNGU) =
        Region(code, "어딘가", code.take(2), "어느도", level, true, 0)

    val svc = RegionLookupService(
        object : RegionCatalogPort {
            val rows = listOf(row("41", RegionLevel.SIDO), row("41110"), row("43740"), row("43745"))
            override fun find(query: String?, level: RegionLevel?) = error("전 POI 집계를 부르면 안 된다 — 후보 요청마다 불린다")
            override fun findByCode(regionCode: String) = rows.firstOrNull { it.regionCode == regionCode }
            override fun findExact(name: String) = emptyList<Region>()
        },
    )

    "시군구는 자기 코드 하나다 — 접두어가 겹치는 다른 군(영동 43740·증평 43745)을 삼키지 않는다" {
        svc.districtCodesOf("41110") shouldBe setOf("41110")
        svc.districtCodesOf("43740") shouldBe setOf("43740")
    }

    "시도·모르는 코드는 빈 집합이다 — 구 안 우선을 걸지 않는다" {
        svc.districtCodesOf("41") shouldBe emptySet()
        svc.districtCodesOf("99999") shouldBe emptySet()
    }
})
