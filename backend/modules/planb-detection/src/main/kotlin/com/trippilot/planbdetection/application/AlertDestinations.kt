package com.trippilot.planbdetection.application

import com.trippilot.planbdetection.domain.WeatherAlerts
import com.trippilot.trip.api.TripDestinationRef
import com.trippilot.trip.api.TripFacade

/**
 * 특보·대기질 감지기가 맞출 **그 날의 목적지** — 여행의 목적지(이름·행정구역 코드·박수)를 박수로 펼친 그 날 몫(옮기는 날은 전날 목적지도).
 * 여행을 못 읽거나(없음·삭제·타 계정) 목적지가 없으면 null 이다 — 호출측이 모름으로 둔다. 코드 없는 목적지(동명이지역)는 그대로 남긴다.
 */
internal fun dayDestinations(trips: TripFacade, target: SweepTarget): List<TripDestinationRef>? {
    val trip = trips.findGenerationContext(target.accountId, target.tripId) ?: return null
    return WeatherAlerts.destinationsOn(trip.destinationRefs, trip.startDate, target.date).takeIf { it.isNotEmpty() }
}
