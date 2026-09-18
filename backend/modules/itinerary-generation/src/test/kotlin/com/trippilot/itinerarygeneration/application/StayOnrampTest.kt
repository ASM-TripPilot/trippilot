package com.trippilot.itinerarygeneration.application

import com.trippilot.itinerarygeneration.application.StayOnramp.Point
import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.shouldBe
import io.kotest.property.Arb
import io.kotest.property.arbitrary.double
import io.kotest.property.arbitrary.list
import io.kotest.property.checkAll

/**
 * 숙소 온램프 거리 계산(US-SCHED-11 · 정본 F-U3-7).
 *
 * 사용자가 이 숫자를 보고 **숙소를 고른다** — 틀리면 엉뚱한 동네에 잡게 만든다.
 * 그래서 저장·외부 호출 없이 입력만으로 결과가 정해지는 순수 계산으로 두고 여기서 못 박는다.
 *
 * **INV-3**: 거리만 다룬다. 소요시간은 계산하지도 표시하지도 않는다.
 */
class StayOnrampTest : StringSpec({

    // 제주 근방 — 위도 1도 ≈ 111km, 경도 1도 ≈ 91km(위도 33도)
    val a = Point(33.50, 126.50)
    val b = Point(33.50, 126.60)
    val c = Point(33.60, 126.50)

    "방문지가 없으면 권역이 없다 — 지어내지 않는다" {
        StayOnramp.regionOf(emptyList()) shouldBe null
    }

    "무게중심은 방문지들의 가운데" {
        val region = StayOnramp.regionOf(listOf(a, b))!!
        region.centroid.lat shouldBe 33.50
        region.centroid.lng shouldBe 126.55
        // 두 점에서 중심까지 거리가 같으므로 평균도 그 값
        (region.avgDistanceM in 4_000..5_500) shouldBe true // ≈ 4.6km
    }

    "한 곳뿐이면 평균 거리는 0 — 중심이 곧 그 지점" {
        StayOnramp.regionOf(listOf(a))!!.avgDistanceM shouldBe 0
    }

    "숙소가 동선 가운데 있으면 평균 구간 거리가 준다" {
        val visits = listOf(a, b)
        val near = StayOnramp.scoreCandidate(visits, Point(33.50, 126.55))!! // 두 점 사이
        val far = StayOnramp.scoreCandidate(visits, Point(33.90, 126.50))!!  // 멀리 북쪽

        (near.afterAvgDistanceM < far.afterAvgDistanceM) shouldBe true
        near.deltaM shouldBe near.afterAvgDistanceM - near.beforeAvgDistanceM
    }

    "before 는 숙소 없이 방문지끼리, after 는 앞뒤에 숙소를 붙인 값" {
        val visits = listOf(a, b, c)
        val score = StayOnramp.scoreCandidate(visits, a)!!
        // 숙소가 첫 방문지와 같은 자리면 앞 구간이 0 이라 평균이 낮아진다
        (score.afterAvgDistanceM <= score.beforeAvgDistanceM) shouldBe true
    }

    "방문지가 없으면 후보를 평가할 수 없다" {
        StayOnramp.scoreCandidate(emptyList(), a) shouldBe null
    }

    "방문지가 하나면 before 는 이동 구간이 없어 0" {
        val score = StayOnramp.scoreCandidate(listOf(a), b)!!
        score.beforeAvgDistanceM shouldBe 0
        (score.afterAvgDistanceM > 0) shouldBe true // 숙소↔방문지 왕복은 거리가 있다
    }

    // ── 속성 ───────────────────────────────────────────────────────────────
    "거리는 음수가 될 수 없다" {
        checkAll(
            Arb.list(Arb.double(33.0, 34.0), 1..6),
            Arb.list(Arb.double(126.0, 127.0), 1..6),
        ) { lats, lngs ->
            val visits = lats.zip(lngs).map { (la, ln) -> Point(la, ln) }
            if (visits.isNotEmpty()) {
                val region = StayOnramp.regionOf(visits)!!
                (region.avgDistanceM >= 0) shouldBe true
                val score = StayOnramp.scoreCandidate(visits, visits.first())!!
                (score.beforeAvgDistanceM >= 0) shouldBe true
                (score.afterAvgDistanceM >= 0) shouldBe true
            }
        }
    }

    "무게중심은 언제나 방문지들의 위경도 범위 안에 있다" {
        checkAll(
            Arb.list(Arb.double(33.0, 34.0), 1..8),
            Arb.list(Arb.double(126.0, 127.0), 1..8),
        ) { lats, lngs ->
            val visits = lats.zip(lngs).map { (la, ln) -> Point(la, ln) }
            if (visits.isNotEmpty()) {
                val centroid = StayOnramp.regionOf(visits)!!.centroid
                (centroid.lat >= visits.minOf { it.lat } && centroid.lat <= visits.maxOf { it.lat }) shouldBe true
                (centroid.lng >= visits.minOf { it.lng } && centroid.lng <= visits.maxOf { it.lng }) shouldBe true
            }
        }
    }
})
