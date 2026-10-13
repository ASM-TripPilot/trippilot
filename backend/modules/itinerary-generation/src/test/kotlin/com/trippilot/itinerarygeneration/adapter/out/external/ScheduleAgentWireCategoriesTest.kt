package com.trippilot.itinerarygeneration.adapter.out.external

import com.trippilot.itinerarygeneration.application.ConceptCategories
import com.trippilot.itinerarygeneration.domain.RequestMeta
import com.trippilot.itinerarygeneration.domain.SlotCandidatesInput
import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.collections.shouldBeEmpty
import io.kotest.matchers.collections.shouldContainAll
import io.kotest.matchers.collections.shouldHaveSize
import io.kotest.matchers.shouldBe
import io.kotest.property.Arb
import io.kotest.property.arbitrary.element
import io.kotest.property.arbitrary.orNull
import io.kotest.property.checkAll
import java.time.Instant
import java.util.UUID

/**
 * 같이 짜기 컨셉이 AI 대안 요청의 `categories` 로 실리는가.
 *
 * 비어 있으면 AI 의 풀 단계 필터(LLM 선택·규칙 폴백이 컨셉 안에서만 고르게 하는 것)가 한 번도 안 돈다 —
 * '식사'를 골라도 명소가 오고 BE 후처리 필터만 그걸 걸러 후보가 줄어든다.
 */
class ScheduleAgentWireCategoriesTest : StringSpec({
    val boundaryCodes = setOf("FOOD", "CAFE", "SIGHT", "NIGHT_VIEW", "NATURE", "CULTURE", "ACTIVITY", "SHOPPING")
    // 기대값을 따로 적는다 — 구현과 같은 식으로 계산하면 매핑이 틀려도 같이 틀린다.
    val expected = mapOf(
        "식사" to listOf("FOOD"),
        "카페" to listOf("CAFE"),
        "전시·문화" to listOf("CULTURE"),
        "야외·산책" to listOf("NATURE"),
        "쇼핑" to listOf("SHOPPING"),
    )

    fun input(concept: String?) = SlotCandidatesInput(
        tripId = UUID.randomUUID(),
        slotKey = "2026-09-01#${UUID.randomUUID()}",
        neighborSlotKeys = emptyList(),
        centerLat = 33.45, centerLng = 126.56,
        radiusM = null, concept = concept, reason = null,
        excludePoiIds = emptyList(), placementReason = null,
        requestMeta = RequestMeta("req-1", Instant.parse("2026-09-01T00:00:00Z"), 25_000L),
    )

    "식사를 고르면 요청 categories 는 FOOD 하나다" {
        input("식사").toAlternativesRequest().categories shouldBe listOf("FOOD")
    }

    "야외·산책은 자연만 — 명소·야경은 싣지 않는다" {
        input("야외·산책").toAlternativesRequest().categories shouldBe listOf("NATURE")
    }

    "컨셉이 없거나 매핑에 없으면 빈 목록(필터 없음)으로 나간다" {
        input(null).toAlternativesRequest().categories.shouldBeEmpty()
        input("  ").toAlternativesRequest().categories.shouldBeEmpty()
        input("아무거나").toAlternativesRequest().categories.shouldBeEmpty()
    }

    "임의 컨셉에서 categories 는 경계 코드 8종 안이고 매핑 컨셉이면 표와 정확히 일치한다" {
        checkAll(Arb.element(expected.keys.toList() + listOf("아무거나", "", " 식사 ")).orNull(0.2)) { concept ->
            val categories = input(concept).toAlternativesRequest().categories
            boundaryCodes shouldContainAll categories
            val mapped = ConceptCategories.of(concept)
            if (mapped == null) {
                categories.shouldBeEmpty()
            } else {
                categories shouldHaveSize mapped.size // 매핑값이 경계 코드로 못 바뀌어 조용히 빠지지 않는다
                categories shouldBe expected.getValue(concept!!.trim())
            }
        }
    }
})
