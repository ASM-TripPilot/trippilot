package com.trippilot.savedaccommodation.domain

import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.shouldBe
import java.time.LocalDate
import java.util.UUID

/** 커버리지 판정(US-TRIP-06 차단형) 구체 시나리오. */
class CoverageResolverTest : StringSpec({

    val start = LocalDate.parse("2026-08-01")
    val end = LocalDate.parse("2026-08-04") // 3박4일 → 숙박일 8/1·8/2·8/3
    val a = UUID.randomUUID()
    val b = UUID.randomUUID()
    fun span(stay: UUID, from: String, to: String) = BaseSpan(stay, LocalDate.parse(from), LocalDate.parse(to))

    "숙박일은 [start, end) — 마지막 날(체크아웃)은 제외" {
        CoverageResolver.resolve(start, end, emptyList()).map { it.date } shouldBe
            listOf(start, start.plusDays(1), start.plusDays(2))
    }

    "전 기간 단일 거점이면 모두 AUTO · 차단 없음" {
        val cov = CoverageResolver.resolve(start, end, listOf(span(a, "2026-08-01", "2026-08-04")))
        cov.map { it.status } shouldBe listOf(CoverageStatus.AUTO, CoverageStatus.AUTO, CoverageStatus.AUTO)
        cov.all { it.savedStayId == a } shouldBe true
        CoverageResolver.blocked(cov) shouldBe false
    }

    "구간이 이어붙어 각 날 후보 1개면 다도시도 AUTO" {
        val cov = CoverageResolver.resolve(
            start, end,
            listOf(span(a, "2026-08-01", "2026-08-03"), span(b, "2026-08-03", "2026-08-04")),
        )
        cov.map { it.savedStayId } shouldBe listOf(a, a, b)
        CoverageResolver.blocked(cov) shouldBe false
    }

    "덮이지 않는 날은 GAP · 차단" {
        val cov = CoverageResolver.resolve(start, end, listOf(span(a, "2026-08-01", "2026-08-03")))
        cov[2].status shouldBe CoverageStatus.GAP
        cov[2].savedStayId shouldBe null
        CoverageResolver.blocked(cov) shouldBe true
    }

    "겹치는 날은 OVERLAP · 차단" {
        val cov = CoverageResolver.resolve(
            start, end,
            listOf(span(a, "2026-08-01", "2026-08-03"), span(b, "2026-08-02", "2026-08-04")),
        )
        cov.map { it.status } shouldBe listOf(CoverageStatus.AUTO, CoverageStatus.OVERLAP, CoverageStatus.AUTO)
        cov[1].savedStayId shouldBe null
        CoverageResolver.blocked(cov) shouldBe true
    }

    "거점이 없으면 전부 GAP · 차단" {
        val cov = CoverageResolver.resolve(start, end, emptyList())
        cov.all { it.status == CoverageStatus.GAP } shouldBe true
        CoverageResolver.blocked(cov) shouldBe true
    }
})
