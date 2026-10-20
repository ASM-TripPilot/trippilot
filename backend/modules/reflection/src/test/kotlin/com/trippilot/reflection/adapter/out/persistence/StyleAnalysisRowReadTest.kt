package com.trippilot.reflection.adapter.out.persistence

import com.trippilot.reflection.domain.CategoryShare
import com.trippilot.reflection.domain.StyleAnalysis
import com.trippilot.reflection.domain.TraitGauges
import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.shouldBe
import io.mockk.every
import io.mockk.mockk
import io.mockk.slot
import tools.jackson.databind.json.JsonMapper
import java.time.Instant
import java.util.Optional
import java.util.UUID

/**
 * style_analysis 행 → 도메인. 잠정 식(O-U5-9)이 바뀌면 축 이름이 바뀔 수 있다. 이 테스트가 보장하는 것:
 * - 모르는 축 이름·타입이 틀린 축은 0 이다.
 * - 카테고리 줄 객체의 이름이 없거나 문자열이 아니면 그 줄을 버리고(이름 없는 막대는 그릴 수 없다),
 *   비율·묶음 표시의 타입이 틀리면 0·false 다.
 * - 저장한 분석은 JSON 왕복 뒤에도 같고, 기존 행이 있으면 그 행을 덮어쓴다.
 *
 * JPA 는 대역이라 Hibernate 가 jsonb 를 엔티티 필드 타입으로 읽어 낸 **뒤의** 어댑터 해석만 본다.
 * 이 테스트가 보장하지 않는 읽기 실패(깨진·범위 밖·모르는 값 → 500)는 TRIP-1476 이 정본으로 모은다 — 여기 목록을 두지 않는다.
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
        read(entity(mapOf("easygoing" to "4", "foodAffinity" to 3, "activeness" to true), emptyList())).traitGauges shouldBe TraitGauges(0, 3, 0)
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

        // jsonb 왕복을 흉내 낸다 — 게이지·비율이 JSON 숫자로 돌아와도 같은 값으로 읽혀야 한다.
        val json = JsonMapper()
        val row = saved.captured
        @Suppress("UNCHECKED_CAST")
        row.traitGauges = json.readValue(json.writeValueAsString(row.traitGauges), Map::class.java) as Map<String, Any?>
        @Suppress("UNCHECKED_CAST")
        row.categoryBreakdown = json.readValue(json.writeValueAsString(row.categoryBreakdown), List::class.java) as List<Map<String, Any?>>
        @Suppress("UNCHECKED_CAST")
        row.descriptors = json.readValue(json.writeValueAsString(row.descriptors), List::class.java) as List<String>
        every { jpa.findById(acc) } returns Optional.of(row)
        StyleAnalysisRepositoryAdapter(jpa).find(acc) shouldBe analysis

        every { jpa.findById(acc) } returns Optional.of(existing)
        StyleAnalysisRepositoryAdapter(jpa).upsert(analysis) shouldBe analysis
        saved.captured shouldBe existing
    }
})
