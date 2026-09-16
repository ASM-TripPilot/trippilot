package com.trippilot.placedata.application

import com.trippilot.placedata.api.RegionCenter
import com.trippilot.placedata.domain.Region
import com.trippilot.placedata.domain.RegionCatalogPort
import com.trippilot.placedata.domain.RegionLevel
import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.nulls.shouldBeNull
import io.kotest.matchers.shouldBe

/**
 * 코드로 찾는 대표 좌표(TRIP-859 후속).
 *
 * ## 왜 따로 잰다
 *
 * 앵커 쪽 스펙(`RegionCodeAnchorTest`)은 **순서**만 본다 — 코드를 먼저 보는가. 그 스펙의 대역은
 * 카탈로그를 흉내 내므로 **여기 구현이 통째로 틀려도 통과한다.** 좌표가 없는 지역을 어떻게
 * 다루는지가 이 구현의 전부인데, 그 판단이 어디에도 안 잠겨 있었다.
 *
 * ## 좌표 없는 지역이 실재한다
 *
 * `Region.lat/lng` 는 **우리가 가진 숙소·POI 의 무게중심**이라 데이터가 한 건도 없는 지역은
 * `null` 이다(`R__update_region_center.sql`). 그걸 0.0 같은 값으로 채우면 **바다 한가운데를
 * 앵커로 보내게 된다** — 지어내지 않고 `null` 로 올려 호출측이 이름으로 떨어지게 한다.
 */
class RegionCenterLookupTest : StringSpec({

    fun region(code: String, lat: Double?, lng: Double?) =
        Region(code, "어딘가", code.take(2), "어느도", RegionLevel.SIGUNGU, true, 0, lat, lng)

    fun serviceWith(vararg rows: Region) = RegionLookupService(
        object : RegionCatalogPort {
            override fun find(query: String?, level: RegionLevel?) = rows.toList()
            override fun findByCode(regionCode: String) = rows.firstOrNull { it.regionCode == regionCode.trim() }
            override fun findExact(name: String) = rows.filter { it.name == name }
        },
    )

    "좌표가 있는 코드는 그 좌표를 준다" {
        val svc = serviceWith(region("50110", 33.4996, 126.5312))

        svc.centerOfCode("50110") shouldBe RegionCenter(33.4996, 126.5312)
    }

    /** 데이터가 없는 지역은 좌표가 null 이다 — **지어내지 않는다**(0.0 이면 바다로 보낸다). */
    "좌표가 없는 지역은 null 이다 — 0.0 으로 채우지 않는다" {
        val svc = serviceWith(region("41110", null, null))

        svc.centerOfCode("41110").shouldBeNull()
    }

    /** 위도만 있고 경도가 없는 반쪽 데이터도 좌표가 아니다. */
    "반쪽 좌표는 좌표가 아니다" {
        val svc = serviceWith(region("41110", 37.26, null))

        svc.centerOfCode("41110").shouldBeNull()
    }

    "카탈로그에 없는 코드는 null 이다" {
        val svc = serviceWith(region("50110", 33.4996, 126.5312))

        svc.centerOfCode("99999").shouldBeNull()
    }
})
