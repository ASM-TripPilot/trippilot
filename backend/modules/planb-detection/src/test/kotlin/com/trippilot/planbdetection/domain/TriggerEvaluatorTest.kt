package com.trippilot.planbdetection.domain

import io.kotest.assertions.throwables.shouldThrow
import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.shouldBe
import io.kotest.property.Arb
import io.kotest.property.arbitrary.enum
import io.kotest.property.checkAll
import java.time.Instant
import java.time.LocalDate
import java.util.UUID

/**
 * 새로 설 대상의 판정(규칙 9 '판정 통과') — 남은 일정에 닿는가(BR-U4-06), 사용자가 껐는가(BR-U4-15).
 * 같은 대상이 이미 떠 있는지(제자리 갱신)와 하루 상한(푸시만 묶는다)은 [TriggerLifecycle] 이 본다.
 */
class TriggerEvaluatorTest : StringSpec({

    val trip = UUID.randomUUID()
    val at = Instant.parse("2026-08-11T03:00:00Z")
    val day = LocalDate.parse("2026-08-11")
    val slotA = "$day#${UUID.randomUUID()}"
    val slotB = "$day#${UUID.randomUUID()}"
    val remaining = setOf(slotA, slotB)

    fun verdict(
        kind: TriggerKind = TriggerKind.WEATHER,
        slotKey: String? = slotA,
        remainingKeys: Set<String> = remaining,
        suppressions: List<Suppression> = emptyList(),
    ) = TriggerEvaluator.verdict(kind, slotKey, day, TriggerSeverity.RISK, remainingKeys, suppressions, at)

    "남은 일정에 닿으면 발화한다" {
        verdict() shouldBe TriggerEvaluator.Verdict.RAISE
    }

    "남은 일정에 없는 슬롯이면 무영향이다(BR-U4-06)" {
        verdict(slotKey = "$day#${UUID.randomUUID()}") shouldBe TriggerEvaluator.Verdict.NOT_AFFECTING
    }

    "날짜 전체 신호는 남은 슬롯이 하나라도 있어야 유효하다" {
        verdict(slotKey = null) shouldBe TriggerEvaluator.Verdict.RAISE
        verdict(slotKey = null, remainingKeys = emptySet()) shouldBe TriggerEvaluator.Verdict.NOT_AFFECTING
    }

    "사용자가 끈 조합은 더 말하지 않는다(BR-U4-15)" {
        val off = Suppression.of(trip, TriggerKind.WEATHER, slotA, SuppressionScope.SLOT, at)
        verdict(suppressions = listOf(off)) shouldBe TriggerEvaluator.Verdict.SUPPRESSED
        verdict(slotKey = slotB, suppressions = listOf(off)) shouldBe TriggerEvaluator.Verdict.RAISE // 다른 슬롯
        verdict(kind = TriggerKind.DELAY, suppressions = listOf(off)) shouldBe TriggerEvaluator.Verdict.RAISE // 다른 사유
    }

    "DAY 범위 억제는 그 날 슬롯을 가리지 않는다" {
        val offDay = Suppression.of(trip, TriggerKind.WEATHER, null, SuppressionScope.DAY, at, affectedDate = day)
        verdict(slotKey = slotA, suppressions = listOf(offDay)) shouldBe TriggerEvaluator.Verdict.SUPPRESSED
        verdict(slotKey = slotB, suppressions = listOf(offDay)) shouldBe TriggerEvaluator.Verdict.SUPPRESSED
    }

    "만료된 억제는 없는 것과 같다 — 그래야 재발화가 가능하다(BR-U4-07)" {
        val expired = Suppression.of(
            trip, TriggerKind.WEATHER, slotA, SuppressionScope.SLOT,
            at.minusSeconds(3600), expiresAt = at.minusSeconds(60),
        )
        verdict(suppressions = listOf(expired)) shouldBe TriggerEvaluator.Verdict.RAISE
    }

    "무영향이 억제보다 먼저다 — 닿지도 않는 신호를 '껐다'고 기록하면 사실과 다르다" {
        val off = Suppression.of(trip, TriggerKind.WEATHER, slotA, SuppressionScope.SLOT, at)
        verdict(slotKey = "$day#${UUID.randomUUID()}", suppressions = listOf(off)) shouldBe
            TriggerEvaluator.Verdict.NOT_AFFECTING
    }

    "발화하는 트리거는 NONE 범위를 가질 수 없다 — 세션 범위로 옮길 자리가 없다" {
        shouldThrow<IllegalArgumentException> {
            PlanBTrigger.active(trip, UUID.randomUUID(), TriggerKind.WEATHER, day, slotA, emptyMap(), TriggerScope.NONE, "비 예보", at)
        }
    }

    "발화하지 않는 판정은 ACTIVE 상태로 남지 않는다 — 남으면 화면에 노출된다(INV-U4-01)" {
        checkAll(Arb.enum<TriggerEvaluator.Verdict>()) { verdict ->
            if (verdict != TriggerEvaluator.Verdict.RAISE) {
                (verdict.state != TriggerState.ACTIVE) shouldBe true
            }
        }
    }
})
