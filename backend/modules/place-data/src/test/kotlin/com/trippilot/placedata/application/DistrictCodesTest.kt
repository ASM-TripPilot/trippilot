package com.trippilot.placedata.application

import com.trippilot.placedata.domain.Region
import com.trippilot.placedata.domain.RegionCatalogPort
import com.trippilot.placedata.domain.RegionLevel
import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.shouldBe

/**
 * "구 안" 판정의 코드 집합(2026-10-23 — 구를 고른 여행은 그 구 안 우선).
 * 일반구가 있는 시(수원시 41110 → 장안구 41111 …)는 POI 가 구 코드로 저장돼 시 코드만 보면 전부 "구 밖"이 된다.
 * 접두어만 보면 영동군 43740 이 증평군 43745 를 삼킨다 — 같은 시도 + 선택 불가(일반구) + 끝자리 0 인 시만 펼친다.
 */
class DistrictCodesTest : StringSpec({

    fun row(code: String, selectable: Boolean, level: RegionLevel = RegionLevel.SIGUNGU) =
        Region(code, "어딘가", code.take(2), "어느도", level, selectable, 0)

    val svc = RegionLookupService(
        object : RegionCatalogPort {
            val rows = listOf(
                row("41", true, RegionLevel.SIDO),
                row("41110", true), row("41111", false), row("41113", false), row("41115", false), row("41117", false),
                row("41130", true),
                row("43740", true), row("43745", true),
                row("11650", true),
            )
            override fun find(query: String?, level: RegionLevel?) = rows.filter { level == null || it.level == level }
            override fun findByCode(regionCode: String) = rows.firstOrNull { it.regionCode == regionCode }
            override fun findExact(name: String) = emptyList<Region>()
        },
    )

    "일반구가 있는 시는 시 코드와 그 일반구 코드를 준다" {
        svc.districtCodesOf("41110") shouldBe setOf("41110", "41111", "41113", "41115", "41117")
    }

    "접두어가 겹치는 다른 군을 삼키지 않는다 — 영동군 43740 ≠ 증평군 43745" {
        svc.districtCodesOf("43740") shouldBe setOf("43740")
    }

    "구는 자기 코드 하나다" {
        svc.districtCodesOf("11650") shouldBe setOf("11650")
    }

    "시도·모르는 코드는 빈 집합이다 — 구 안 우선을 걸지 않는다" {
        svc.districtCodesOf("41") shouldBe emptySet()
        svc.districtCodesOf("99999") shouldBe emptySet()
    }
})
