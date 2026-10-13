package com.trippilot.itinerarygeneration.application

import com.trippilot.itinerarygeneration.domain.DayAnchor
import com.trippilot.placedata.api.RegionCenter
import com.trippilot.placedata.api.RegionLookupFacade
import com.trippilot.savedaccommodation.api.DayAnchorView
import com.trippilot.trip.api.TripDestinationRef
import java.time.LocalDate
import java.time.temporal.ChronoUnit

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

    /**
     * 계획일 [date] 가 어느 목적지의 날인가 — FE `dayRegion.ts`(같이 짜기 "그날 여행지")와 **같은 규칙**.
     * [refs](seq 순)를 박수만큼 펼치고, 박수 합을 넘는 날(체크아웃일 포함)은 마지막 목적지다.
     * 두 규칙이 갈리면 화면이 "인천"이라 적은 날에 서울 일정이 나온다. 목적지가 없으면 null.
     */
    fun destinationOn(refs: List<TripDestinationRef>, startDate: LocalDate, date: LocalDate): TripDestinationRef? {
        var remaining = ChronoUnit.DAYS.between(startDate, date) + 1
        for (ref in refs) {
            if (remaining <= ref.nights) return ref
            remaining -= ref.nights
        }
        return refs.lastOrNull()
    }

    /**
     * 계획일별 공간 앵커 — 우선순위: 숙소 좌표(체크아웃일은 전날 거점) → 그 날의 목적지 중심 → 첫 목적지 중심.
     * 근거는 `GenerateItineraryService.dayAnchors` KDoc. 생성과 편집 수리(repair)가 **같은 앵커**를 AI 에
     * 보내야 해서 여기로 올렸다(2026-10-05) — 두 벌이면 한쪽만 고쳐 첫 구간 거리가 생성과 어긋난다.
     */
    fun dayAnchors(
        regions: RegionLookupFacade,
        startDate: LocalDate,
        endDate: LocalDate,
        stayAnchors: List<DayAnchorView>,
        destinations: List<TripDestinationRef>,
    ): List<DayAnchor> {
        val byDate = stayAnchors.associateBy { it.date }
        // 목적지 중심은 목적지마다 한 번만 조회한다 — 날짜마다 부르면 같은 값을 계획일 수만큼 다시 읽는다.
        val centers = destinations.associateWith { centerOf(regions, it) }
        val first = destinations.firstNotNullOfOrNull { centers[it] }
        return generateSequence(startDate) { it.plusDays(1) }.takeWhile { !it.isAfter(endDate) }.mapNotNull { d ->
            val stay = byDate[d] ?: if (d == endDate) byDate[d.minusDays(1)] else null // 체크아웃일만 전날 거점
            val center = destinationOn(destinations, startDate, d)?.let { centers[it] } ?: first
            when {
                stay != null -> DayAnchor(d, stay.lat, stay.lng)
                // 목적지 좌표조차 없으면 그 날은 앵커 없이 둔다 — 지어낸 좌표를 보내지 않는다.
                center != null -> DayAnchor(d, center.lat, center.lng)
                else -> null
            }
        }.toList()
    }
}
