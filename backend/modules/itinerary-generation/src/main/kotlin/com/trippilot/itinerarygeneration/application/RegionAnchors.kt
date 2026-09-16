package com.trippilot.itinerarygeneration.application

import com.trippilot.placedata.api.RegionCenter
import com.trippilot.placedata.api.RegionLookupFacade
import com.trippilot.trip.api.TripDestinationRef

/**
 * 목적지 하나에서 앵커 좌표를 고르는 규칙(TRIP-859 후속).
 *
 * ## 왜 따로 있나
 *
 * **순서가 이 규칙의 전부다** — 코드가 있으면 코드로, 없으면 이름으로. 뒤집으면 코드를 받아
 * 저장해 두고도 동명이지역 임의 선택이 그대로 남는다. 저장은 되는데 아무것도 안 달라지는,
 * 가장 알아채기 어려운 실패다.
 *
 * 서비스 안에 private 으로 두면 **테스트가 같은 규칙을 다시 적어** 비교하게 되고, 그러면 생산
 * 코드의 순서가 뒤집혀도 테스트는 자기 사본을 보고 통과한다. 여기로 빼서 **같은 것을 부르게** 한다.
 *
 * ## 왜 이름 경로를 남기나
 *
 * 코드가 `null` 인 목적지가 정상이다 — 코드를 안 보내는 옛 클라이언트, 이름만으로 확정하지 못한
 * 동명이지역. 이 갈래를 없애면 그런 여행의 앵커가 통째로 사라진다(숙소가 없는 날은 앵커 없이 간다).
 */
internal object RegionAnchors {

    fun centerOf(regions: RegionLookupFacade, ref: TripDestinationRef): RegionCenter? =
        ref.regionCode?.let { regions.centerOfCode(it) } ?: regions.centerOf(ref.name)
}
