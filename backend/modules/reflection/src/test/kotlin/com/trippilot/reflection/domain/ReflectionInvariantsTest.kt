package com.trippilot.reflection.domain

import io.kotest.assertions.throwables.shouldThrow
import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.shouldBe
import java.time.Instant
import java.time.LocalDate
import java.util.UUID

/**
 * 회고 도메인의 생성 불변식 — 저장·응답에 닿기 전에 막아야 하는 값들.
 *
 * 특히 INV-U5-09: 임계(누적 방문 10곳) 미만의 정식 분석은 **타입으로 존재할 수 없다** — 미리보기를 실수로
 * 저장하는 경로를 생성자가 닫는다.
 */
class ReflectionInvariantsTest : StringSpec({

    val acc = UUID.randomUUID()
    val t0 = Instant.parse("2026-08-03T00:00:00Z")

    fun analysis(visits: Int = 10, perDay: Double = 1.0, radius: Double = 1.0, dwell: Int? = null) = StyleAnalysis(
        acc, emptyList(), TraitGauges(0, 0, 0), emptyList(), perDay, radius, dwell, 1, visits, t0,
    )

    "정식 분석은 누적 방문 10곳부터다 — 9곳이면 만들 수 없다(INV-U5-09)" {
        shouldThrow<IllegalArgumentException> { analysis(visits = StyleAnalysis.MIN_VISITS - 1) }
        analysis(visits = StyleAnalysis.MIN_VISITS).sampleVisitCount shouldBe 10
    }

    "평균 방문 수·반경·체류는 음수일 수 없다 — 체류를 모르면 null 은 허용한다" {
        shouldThrow<IllegalArgumentException> { analysis(perDay = -0.1) }
        shouldThrow<IllegalArgumentException> { analysis(radius = -0.1) }
        shouldThrow<IllegalArgumentException> { analysis(dwell = -1) }
        // 경계 0 은 허용이다 — `>= 0` 이 `> 0` 으로 바뀌면 여기서 던진다.
        analysis(perDay = 0.0).avgPlacesPerDay shouldBe 0.0
        analysis(radius = 0.0).avgRadiusKm shouldBe 0.0
        analysis(dwell = null).avgDwellMinutes shouldBe null
        analysis(dwell = 0).avgDwellMinutes shouldBe 0
    }

    "게이지는 세 축 모두 0~5 다" {
        listOf(-1, 6).forEach { bad ->
            shouldThrow<IllegalArgumentException> { TraitGauges(bad, 0, 0) }
            shouldThrow<IllegalArgumentException> { TraitGauges(0, bad, 0) }
            shouldThrow<IllegalArgumentException> { TraitGauges(0, 0, bad) }
        }
        // 경계값 0·5 는 만들어진다 — 던지지 않는 것이 확인이다.
        TraitGauges(0, 0, 0)
        TraitGauges(5, 5, 5)
    }

    "카테고리 비율은 0~1 이다" {
        shouldThrow<IllegalArgumentException> { CategoryShare("맛집", -0.01) }
        shouldThrow<IllegalArgumentException> { CategoryShare("맛집", 1.01) }
        CategoryShare("맛집", 0.0).ratio shouldBe 0.0
        CategoryShare("맛집", 1.0).ratio shouldBe 1.0
    }

    "회고 카드는 원문이 비면 만들 수 없다(INV-U5-07)" {
        shouldThrow<IllegalArgumentException> { ReflectionCard("t", "CARD", "제목", "", " ") }
    }

    "근거 수치는 방문·사진·거리 어느 것도 음수일 수 없다" {
        shouldThrow<IllegalArgumentException> { ReflectionStats(-1, 0.0, DistanceSource.VISIT_LINE, 0) }
        shouldThrow<IllegalArgumentException> { ReflectionStats(0, 0.0, DistanceSource.VISIT_LINE, -1) }
        shouldThrow<IllegalArgumentException> { ReflectionStats(0, -0.1, DistanceSource.VISIT_LINE, 0) }
    }

    "요약은 본문이 비면 안 되고, 수치는 음수일 수 없다(PBT-U5-1)" {
        val stats = TripSummaryStats(0, 0.0, DistanceSource.VISIT_LINE, 0, false)
        shouldThrow<IllegalArgumentException> { TripSummary(UUID.randomUUID(), " ", emptyList(), stats, ReflectionSource.BASIC, t0) }
        shouldThrow<IllegalArgumentException> { TripSummaryStats(-1, 0.0, DistanceSource.VISIT_LINE, 0, false) }
        shouldThrow<IllegalArgumentException> { TripSummaryStats(0, 0.0, DistanceSource.VISIT_LINE, -1, false) }
        shouldThrow<IllegalArgumentException> { TripSummaryStats(0, -0.1, DistanceSource.VISIT_LINE, 0, false) }
    }

    "기분·메모: null 은 그대로 두고 빈 문자열은 지운다 — 메모만 고쳐도 기분이 지워지지 않는다" {
        val card = ReflectionCard("t", "CARD", "제목", "", "{}")
        val r = Reflection.of(UUID.randomUUID(), LocalDate.parse("2026-08-01"), card, ReflectionSource.RULE, ReflectionStats.empty(), t0)
            .note("happy", "좋았다", t0)

        r.note(null, "다시 씀", t0).let { (it.mood to it.shortMemo) shouldBe ("happy" to "다시 씀") }
        r.note("calm", null, t0).let { (it.mood to it.shortMemo) shouldBe ("calm" to "좋았다") }
        r.note("", "  ", t0).let { (it.mood to it.shortMemo) shouldBe (null to null) }
    }
})
