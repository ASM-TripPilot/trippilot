package com.trippilot.itinerarygeneration.domain

import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.shouldBe
import io.kotest.property.Arb
import io.kotest.property.arbitrary.arbitrary
import io.kotest.property.arbitrary.element
import io.kotest.property.arbitrary.int
import io.kotest.property.arbitrary.list
import io.kotest.property.arbitrary.map
import io.kotest.property.arbitrary.orNull
import io.kotest.property.checkAll
import java.time.Instant
import java.time.LocalDate
import java.time.LocalTime
import java.util.UUID

/**
 * 취향 점수 신호(TRIP-1173) — 두 생성 호출 합치기와 전이 보존.
 * 불변식: **한쪽이라도 모르면 합친 결과도 모름**이다. 2차가 폴백으로 떨어졌는데 1차의 LLM 이 남으면
 * 앱이 "AI 가 다 짰다"고 보여 저하가 감춰진다(INV-4).
 */
class ScoringSignalTest : StringSpec({
    val now = Instant.parse("2026-08-05T00:00:00Z")
    val d1 = LocalDate.parse("2026-08-10")

    fun slot() = VisitSlot.of(UUID.randomUUID(), null, 0, LocalTime.parse("10:00"), LocalTime.parse("11:00"))

    // 한 신호는 어댑터를 거친 모양이다 — 고유 코드 0..16개(상한). 두 신호의 합집합은 32개까지 갈 수 있다.
    val codes = Arb.list(Arb.int(0..40).map { "stage:reason_$it" }, 0..ScoringSignal.MAX_DEGRADATIONS).map { it.distinct() }
    val signals = arbitrary { ScoringSignal(Arb.element(ScoringMode.entries).orNull().bind(), codes.bind()) }

    "합친 출처는 과장하지 않는다 — 모름이 섞이면 모름, LLM·RULE 은 양쪽이 같을 때만, 갈리면 MIXED, 강등 코드는 빠짐·중복 없이 상한 안" {
        checkAll(signals, signals) { a, b ->
            val m = a.merge(b)
            (m.mode == null) shouldBe (a.mode == null || b.mode == null)
            if (m.mode == ScoringMode.LLM || m.mode == ScoringMode.RULE) {
                (a.mode == m.mode && b.mode == m.mode) shouldBe true
            }
            if (a.mode != null && b.mode != null && a.mode != b.mode) m.mode shouldBe ScoringMode.MIXED
            val union = (a.degradations + b.degradations).toSet()
            m.degradations.size shouldBe m.degradations.toSet().size                      // 중복 없음
            (m.degradations.size <= ScoringSignal.MAX_DEGRADATIONS) shouldBe true          // 합쳐도 상한
            union.containsAll(m.degradations) shouldBe true                               // 지어내지 않음
            if (union.size <= ScoringSignal.MAX_DEGRADATIONS) m.degradations.toSet() shouldBe union // 빠짐 없음
            m.degradations.take(a.degradations.size) shouldBe a.degradations.take(m.degradations.size) // 1차가 앞
        }
    }

    "1차 LLM + 2차 RULE → MIXED, 1차 LLM + 2차 최소 폴백(모름) → 모름" {
        val llm = ScoringSignal(ScoringMode.LLM, emptyList())
        llm.merge(ScoringSignal(ScoringMode.RULE, listOf("llm:c1_fallback"))) shouldBe
            ScoringSignal(ScoringMode.MIXED, listOf("llm:c1_fallback"))
        llm.merge(ScoringSignal.UNKNOWN) shouldBe ScoringSignal.UNKNOWN
    }

    "합쳐도 강등 코드는 16개 — 1차 16개 + 2차 고유 16개면 1차 것만 남는다(저장·노출 상한)" {
        val first = (1..16).map { "first:r_$it" }
        val second = (1..16).map { "second:r_$it" }
        ScoringSignal(ScoringMode.LLM, first).merge(ScoringSignal(ScoringMode.LLM, second)).degradations shouldBe first
    }

    fun partial(scoring: ScoringSignal) = Itinerary.create(
        UUID.randomUUID(), SolveMode.FULL_AI, GenerationMode.FULLY_AI, false,
        listOf(ItineraryDay.of(d1, 0, listOf(slot()))), now, GenerationState.PARTIAL, scoring = scoring,
    )

    "2차 완료 — 2차 신호가 있으면 합치고, 2차 호출이 없었으면(null) 1차 값이 최종" {
        val first = ScoringSignal(ScoringMode.LLM, listOf("weather:weather_error"))
        val allDays = listOf(ItineraryDay.of(d1, 0, listOf(slot())), ItineraryDay.of(d1.plusDays(1), 1, listOf(slot())))

        partial(first).completeGeneration(allDays, now, secondUnplaced = emptyList(), secondScoring = ScoringSignal(ScoringMode.RULE, listOf("llm:c1_fallback")))
            .scoring shouldBe ScoringSignal(ScoringMode.MIXED, listOf("weather:weather_error", "llm:c1_fallback"))
        partial(first).completeGeneration(allDays, now, secondUnplaced = emptyList(), secondScoring = null)
            .scoring shouldBe first
    }

    "확정·동결 확정·2차 실패 전이에서 신호가 사라지지 않는다" {
        val signal = ScoringSignal(ScoringMode.RULE, listOf("llm:c1_fallback"))
        val done = Itinerary.create(
            UUID.randomUUID(), SolveMode.FULL_AI, GenerationMode.FULLY_AI, false,
            listOf(ItineraryDay.of(d1, 0, listOf(slot()))), now, scoring = signal,
        )
        done.confirm(now).scoring shouldBe signal
        done.confirm(done.days.single().slots.associate { it.sourcePoiId to UUID.randomUUID() }, now).scoring shouldBe signal
        partial(signal).failGeneration(now).scoring shouldBe signal
    }
})
