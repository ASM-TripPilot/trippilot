package com.trippilot.savedaccommodation.domain

import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.shouldBe
import io.kotest.property.Arb
import io.kotest.property.arbitrary.int
import io.kotest.property.arbitrary.list
import io.kotest.property.arbitrary.pair
import io.kotest.property.checkAll
import java.time.LocalDate
import java.util.UUID

/**
 * 커버리지 리졸버 게이트 PBT-U1-2. 임의 기간·거점 스팬에 대해:
 * (1) 숙박일 [start, end) 정확 매핑 (2) 각 날 판정 = 덮는 거점 수 (3) blocked ⟺ 미해결 존재.
 */
class CoveragePropertyTest : StringSpec({

    val start = LocalDate.parse("2026-08-01")

    "각 숙박일은 덮는 거점 수로 정확히 판정되고 차단은 미해결과 동치" {
        checkAll(
            Arb.int(1..14),
            Arb.list(Arb.pair(Arb.int(0..14), Arb.int(0..14)), 0..5),
        ) { nights, rawSpans ->
            val end = start.plusDays(nights.toLong())
            val spans = rawSpans.map { (x, y) ->
                val from = minOf(x, y)
                val to = maxOf(x, y).let { if (it == from) from + 1 else it } // dateTo > dateFrom 보장
                BaseSpan(UUID.randomUUID(), start.plusDays(from.toLong()), start.plusDays(to.toLong()))
            }

            val cov = CoverageResolver.resolve(start, end, spans)

            // (1) 숙박일 정확히 [start, end)
            cov.map { it.date } shouldBe (0 until nights).map { start.plusDays(it.toLong()) }

            // (2) 각 날 판정 = 그 날을 덮는 거점 수
            cov.forEach { day ->
                val covering = spans.filter { !day.date.isBefore(it.dateFrom) && day.date.isBefore(it.dateTo) }
                when (covering.size) {
                    0 -> {
                        day.status shouldBe CoverageStatus.GAP
                        day.savedStayId shouldBe null
                    }
                    1 -> {
                        day.status shouldBe CoverageStatus.AUTO
                        day.savedStayId shouldBe covering.single().savedStayId
                    }
                    else -> {
                        day.status shouldBe CoverageStatus.OVERLAP
                        day.savedStayId shouldBe null
                    }
                }
            }

            // (3) 차단 ⟺ AUTO가 아닌 날 존재
            CoverageResolver.blocked(cov) shouldBe cov.any { it.status != CoverageStatus.AUTO }
        }
    }
})
