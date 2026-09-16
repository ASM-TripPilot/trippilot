package com.trippilot.itinerarygeneration.application

import com.trippilot.placedata.api.RegionCenter
import com.trippilot.placedata.api.RegionLookupFacade
import com.trippilot.trip.api.TripDestinationRef
import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.shouldBe

/**
 * 목적지 코드로 앵커를 잡는다(TRIP-859 후속).
 *
 * ## 무엇을 막는가
 *
 * `centerOf(이름)` 은 동명이지역에서 **첫 코드를 임의로 집는다**. 부산 중구를 고른 사용자에게
 * 서울 중구 좌표가 앵커로 박히고, 증상은 *"일정이 다른 동네에서 돈다"* 라 원인이 안 보인다.
 * TRIP-859 가 코드를 **받아 저장하는 데까지** 했고, 이 스펙은 그 코드가 **실제로 쓰이는지**를 본다.
 *
 * ## 순서가 전부다
 *
 * 코드가 있으면 코드로, 없으면 이름으로. 뒤집으면 코드를 받아 두고도 임의 선택이 그대로 남는다 —
 * 저장은 되는데 아무것도 안 달라지는, 가장 알아채기 어려운 실패다.
 */
class RegionCodeAnchorTest : StringSpec({

    /** 이름은 늘 **서울 중구**로, 코드 `26170` 은 **부산 중구**로 답하는 카탈로그. */
    val ambiguous = object : RegionLookupFacade {
        var nameLookups = 0
        override fun codesOf(regionName: String) = listOf("11140", "26170")
        override fun isSelectableCode(regionCode: String) = true
        override fun centerOf(regionName: String): RegionCenter? {
            nameLookups++
            return RegionCenter(SEOUL_LAT, SEOUL_LNG)
        }
        override fun centerOfCode(regionCode: String): RegionCenter? =
            if (regionCode == "26170") RegionCenter(BUSAN_LAT, BUSAN_LNG) else null
    }

    "코드가 있으면 코드로 찾는다 — 이름으로는 서울이 나오는 상황에서 부산이 나온다" {
        val center = anchorCenter(ambiguous, TripDestinationRef("중구", "26170"))

        center shouldBe RegionCenter(BUSAN_LAT, BUSAN_LNG)
    }

    /**
     * 코드가 없는 목적지(옛 클라이언트·확정 못 한 동명이지역)는 **종전대로** 이름으로 떨어진다.
     * 이 갈래가 없으면 코드를 안 보내는 클라이언트의 앵커가 통째로 사라진다.
     */
    "코드가 없으면 이름으로 떨어진다" {
        val center = anchorCenter(ambiguous, TripDestinationRef("중구", null))

        center shouldBe RegionCenter(SEOUL_LAT, SEOUL_LNG)
    }

    /**
     * **코드로 찾았으면 이름은 아예 안 본다.** 둘 다 부르고 코드를 고르는 구현도 결과는 같지만,
     * 그러면 카탈로그 조회가 두 배가 되고 "이름 경로가 아직 산다"는 사실이 숨는다.
     */
    "코드로 찾은 경우 이름 조회를 하지 않는다" {
        val probe = object : RegionLookupFacade {
            var nameLookups = 0
            override fun codesOf(regionName: String) = emptyList<String>()
            override fun isSelectableCode(regionCode: String) = true
                override fun centerOf(regionName: String): RegionCenter? {
                nameLookups++
                return RegionCenter(SEOUL_LAT, SEOUL_LNG)
            }
            override fun centerOfCode(regionCode: String) = RegionCenter(BUSAN_LAT, BUSAN_LNG)
        }

        anchorCenter(probe, TripDestinationRef("중구", "26170"))

        probe.nameLookups shouldBe 0
    }

    /** 코드가 카탈로그에 없으면(좌표 없는 지역 포함) 이름으로 떨어진다 — 앵커를 잃지 않는다. */
    "코드로 못 찾으면 이름으로 떨어진다" {
        val center = anchorCenter(ambiguous, TripDestinationRef("중구", "99999"))

        center shouldBe RegionCenter(SEOUL_LAT, SEOUL_LNG)
    }
})

private const val SEOUL_LAT = 37.5636
private const val SEOUL_LNG = 126.9976
private const val BUSAN_LAT = 35.1064
private const val BUSAN_LNG = 129.0324

/**
 * **생산 코드를 그대로 부른다.** 여기서 규칙을 다시 적으면(코드 먼저, 없으면 이름) 생산 쪽 순서가
 * 뒤집혀도 테스트는 자기 사본을 보고 통과한다 — 상수를 자기 자신과 비교하는 것과 같은 함정이다.
 * 그래서 규칙을 [RegionAnchors] 로 빼 두고 양쪽이 같은 것을 부른다.
 */
private fun anchorCenter(regions: RegionLookupFacade, ref: TripDestinationRef): RegionCenter? =
    RegionAnchors.centerOf(regions, ref)
