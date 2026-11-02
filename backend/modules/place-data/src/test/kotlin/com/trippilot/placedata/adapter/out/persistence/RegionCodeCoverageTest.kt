package com.trippilot.placedata.adapter.out.persistence

import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.shouldBe
import io.kotest.property.Arb
import io.kotest.property.arbitrary.element
import io.kotest.property.arbitrary.list
import io.kotest.property.arbitrary.arbitrary
import io.kotest.property.checkAll
import io.mockk.every
import io.mockk.mockk
import io.mockk.verify

/**
 * 덮인 지역 코드 빼기(TRIP-1723).
 *
 * 조회의 매칭은 "region_code 가 그 코드로 시작한다"다(`substring(region_code, 1, len) in (codes)`).
 * 덮인 코드를 빼도 **매칭 집합이 같아야** 하고, `제주`([50, 50110])는 **한 쿼리**가 되어야 한다.
 */
class RegionCodeCoverageTest : StringSpec({

    "덮인 코드를 빼도 매칭 집합이 같다" {
        // 짧은 알파벳이라야 접두 관계가 자주 생긴다 — 무작위 숫자 5자리끼리는 거의 겹치지 않아 아무것도 재지 않는다.
        val digits = Arb.list(Arb.element("1", "2", "5", "0"), 1..5)
        val codeArb = arbitrary { rs -> digits.sample(rs).value.joinToString("") }
        checkAll(Arb.list(codeArb, 1..6), Arb.list(codeArb, 0..20)) { codes, rows ->
            fun matched(cs: List<String>) = rows.filter { r -> cs.any { r.startsWith(it) } }.toSet()
            val dropped = dropCoveredCodes(codes)
            matched(dropped) shouldBe matched(codes)
            // 남은 코드끼리는 서로 덮지 않는다 — 그래야 같은 길이 묶음이 한 층이 된다.
            dropped.none { c -> dropped.any { it != c && c.startsWith(it) } } shouldBe true
        }
    }

    "제주(50·50110)는 시도 한 쿼리로 끝난다 — 길이 혼합 병합 경로로 가지 않는다" {
        val jpa = mockk<PoiJpaRepository>()
        every { jpa.findActiveByRegionPrefixes(any(), any(), any(), any(), any(), any(), any(), any(), any()) } returns emptyList()

        PoiRepositoryAdapter(jpa).findActive(listOf("50", "50110"), null, "", null, 10)

        verify(exactly = 1) { jpa.findActiveByRegionPrefixes(2, listOf("50"), null, "", -1, "", any(), 10, "") }
        verify(exactly = 1) { jpa.findActiveByRegionPrefixes(any(), any(), any(), any(), any(), any(), any(), any(), any()) }
    }

    "덮이지 않는 혼합(다른 시도의 시군구 + 시도)은 그대로 둔다" {
        dropCoveredCodes(listOf("50", "26440")) shouldBe listOf("50", "26440")
        dropCoveredCodes(listOf("50110", "50", "50110")) shouldBe listOf("50")
    }
})
