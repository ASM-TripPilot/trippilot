package com.trippilot.reflection.adapter.out.persistence

import com.trippilot.reflection.domain.CategoryShare
import com.trippilot.reflection.domain.StyleAnalysis
import com.trippilot.reflection.domain.TraitGauges
import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.shouldBe
import io.mockk.every
import io.mockk.mockk
import io.mockk.slot
import java.time.Instant
import java.util.Optional
import java.util.UUID

/**
 * style_analysis 행 → 도메인. 잠정 식(O-U5-9)이 바뀌면 축 이름이 바뀔 수 있어 읽기는 방어적이다 —
 * 못 읽는 축은 0, 이름 없는 카테고리 줄은 버린다(이름 없는 막대는 그릴 수 없다).
 */
class StyleAnalysisRowReadTest : StringSpec({

    val acc = UUID.randomUUID()
    val t0 = Instant.parse("2026-08-03T00:00:00Z")

    fun entity(gauges: Map<String, Any?>, breakdown: List<Map<String, Any?>>) =
        StyleAnalysisEntity(acc, listOf("느긋한"), gauges, breakdown, 2.5, 3.0, null, 2, 12, t0)

    fun read(e: StyleAnalysisEntity): StyleAnalysis {
        val jpa = mockk<StyleAnalysisJpaRepository>()
        every { jpa.findById(acc) } returns Optional.of(e)
        return StyleAnalysisRepositoryAdapter(jpa).find(acc)!!
    }

    "모르는 축 이름·타입이 틀린 축은 0 으로 읽는다 — 예외 없음" {
        read(entity(mapOf("relaxed" to 4, "foodAffinity" to "3", "activeness" to null), emptyList())).traitGauges shouldBe TraitGauges(0, 0, 0)
        read(entity(mapOf("easygoing" to 4, "foodAffinity" to 3, "activeness" to 5), emptyList())).traitGauges shouldBe TraitGauges(4, 3, 5)
    }

    "카테고리 이름이 없거나 문자열이 아닌 줄은 버리고, 비율·묶음 표시가 깨진 줄은 0·false 로 읽는다" {
        val rows = read(
            entity(
                emptyMap(),
                listOf(
                    mapOf("ratio" to 0.5),
                    mapOf("category" to 7, "ratio" to 0.2),
                    mapOf("category" to "맛집", "ratio" to 0.6, "isOther" to false),
                    mapOf("category" to "기타", "ratio" to "많이", "isOther" to "true"),
                ),
            ),
        ).categoryBreakdown
        rows shouldBe listOf(CategoryShare("맛집", 0.6, false), CategoryShare("기타", 0.0, false))
    }

    "저장한 분석은 그대로 다시 읽힌다 — 기존 행이 있으면 그 행을 덮어쓴다(계정당 하나)" {
        val existing = entity(emptyMap(), emptyList())
        val jpa = mockk<StyleAnalysisJpaRepository>()
        val saved = slot<StyleAnalysisEntity>()
        every { jpa.save(capture(saved)) } answers { saved.captured }
        val analysis = StyleAnalysis(
            acc, listOf("미식가"), TraitGauges(1, 5, 2),
            listOf(CategoryShare("맛집", 0.7), CategoryShare(CategoryShare.OTHER, 0.3, isOther = true)),
            3.5, 4.25, 45, 3, 20, t0.plusSeconds(60),
        )

        every { jpa.findById(acc) } returns Optional.empty()
        StyleAnalysisRepositoryAdapter(jpa).upsert(analysis) shouldBe analysis

        every { jpa.findById(acc) } returns Optional.of(existing)
        StyleAnalysisRepositoryAdapter(jpa).upsert(analysis) shouldBe analysis
        saved.captured shouldBe existing
    }
})
