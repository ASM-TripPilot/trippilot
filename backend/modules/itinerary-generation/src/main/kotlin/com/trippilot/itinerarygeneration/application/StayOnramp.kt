package com.trippilot.itinerarygeneration.application

import kotlin.math.asin
import kotlin.math.cos
import kotlin.math.pow
import kotlin.math.sin
import kotlin.math.sqrt

/**
 * 숙소 나중 등록 온램프의 **거리 계산**(US-SCHED-11 · 정본 F-U3-7).
 *
 * 순수 함수로 둔 이유: 사용자가 이 숫자를 보고 숙소를 고른다. 저장·외부 호출과 섞이면
 * "왜 이 권역인가"를 되짚을 수 없고, 잘못되면 **엉뚱한 동네에 숙소를 잡게** 만든다.
 *
 * **INV-3**: 거리(m)만 다룬다. 소요시간은 계산하지도 표시하지도 않는다.
 *
 * 무게중심·평균 거리는 **산술**이라 백엔드가 한다. 후보를 실제로 고르는 최적화는 솔버 몫이며
 * 여기서 하지 않는다(TRIP-269 AC).
 */
object StayOnramp {

    data class Point(val lat: Double, val lng: Double)

    /**
     * 권역 추천(h27 지도).
     *
     * @param centroid 방문지 무게중심 — 지도에서 "이 근처" 를 가리키는 점
     * @param avgDistanceM 무게중심에서 각 방문지까지의 평균 거리 — 권역 반경의 근거
     */
    data class Region(val centroid: Point, val avgDistanceM: Int)

    /**
     * 후보 평가(h28).
     *
     * @param beforeAvgDistanceM 숙소 없이 방문지끼리 이어 다닐 때의 평균 구간 거리
     * @param afterAvgDistanceM 그 숙소에서 출발·복귀할 때의 평균 구간 거리
     */
    data class CandidateScore(val beforeAvgDistanceM: Int, val afterAvgDistanceM: Int) {
        /** 음수면 줄어든 것이다 — 화면이 "평균 N m 줄어요" 로 쓴다. */
        val deltaM: Int get() = afterAvgDistanceM - beforeAvgDistanceM
    }

    /**
     * 방문지 무게중심. **위경도를 그대로 평균 낸다** — 국내(한 나라 안) 범위라 이 근사로 충분하고,
     * 구면 무게중심을 쓰면 계산이 복잡해지는 대신 결과 차이는 미터 단위다.
     * 방문지가 없으면 null — 지어내지 않는다.
     */
    fun regionOf(visits: List<Point>): Region? {
        if (visits.isEmpty()) return null
        val centroid = Point(visits.sumOf { it.lat } / visits.size, visits.sumOf { it.lng } / visits.size)
        val avg = visits.map { distanceM(centroid, it) }.average()
        return Region(centroid, avg.toInt())
    }

    /**
     * 숙소를 출발·복귀 기준으로 삼았을 때 평균 구간 거리가 어떻게 달라지는가.
     *
     * `before` 는 방문지끼리만 이어 다닌 경우(숙소 없음), `after` 는 앞뒤에 숙소를 붙인 경우다.
     * 방문지가 없으면 비교할 대상이 없어 null.
     */
    fun scoreCandidate(visitsInOrder: List<Point>, stay: Point): CandidateScore? {
        if (visitsInOrder.isEmpty()) return null
        val before = averageLegM(visitsInOrder)
        val after = averageLegM(listOf(stay) + visitsInOrder + stay)
        return CandidateScore(before, after)
    }

    /** 구간 평균 거리. 지점이 하나뿐이면 이동 구간이 없어 0이다. */
    private fun averageLegM(points: List<Point>): Int {
        if (points.size < 2) return 0
        val legs = points.zipWithNext { a, b -> distanceM(a, b) }
        return legs.average().toInt()
    }

    /** 하버사인 직선 거리(m). 실제 경로가 아니라 **추정**이며 화면도 추정으로 표기한다. */
    private fun distanceM(a: Point, b: Point): Double {
        val dLat = Math.toRadians(b.lat - a.lat)
        val dLng = Math.toRadians(b.lng - a.lng)
        val h = sin(dLat / 2).pow(2) +
            cos(Math.toRadians(a.lat)) * cos(Math.toRadians(b.lat)) * sin(dLng / 2).pow(2)
        return 2 * EARTH_RADIUS_M * asin(sqrt(h))
    }

    private const val EARTH_RADIUS_M = 6_371_000.0
}
