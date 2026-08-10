package com.trippilot.planbdetection.domain

import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.shouldBe
import io.kotest.property.Arb
import io.kotest.property.arbitrary.enum
import io.kotest.property.arbitrary.int
import io.kotest.property.checkAll
import java.time.Instant
import java.util.UUID

/**
 * 판정(LC-U4-1). 클라이언트는 임계를 모르고 신호만 보낸다 — 알릴지는 **여기서만** 정해진다(BR-U4-03).
 *
 * 지키려는 것: 남은 일정에 닿는 신호만(BR-U4-06) · 같은 사유×같은 슬롯은 1회(BR-U4-07) ·
 * 사용자가 끈 조합은 더 말하지 않음(BR-U4-15) · 하루 총량(BR-U4-08).
 */
class TriggerEvaluatorTest : StringSpec({

    val trip = UUID.randomUUID()
    val at = Instant.parse("2026-08-11T03:00:00Z")
    val slotA = "2026-08-11#${UUID.randomUUID()}"
    val slotB = "2026-08-11#${UUID.randomUUID()}"
    val remaining = setOf(slotA, slotB)

    fun judge(
        kind: TriggerKind = TriggerKind.WEATHER,
        slotKey: String? = slotA,
        remainingKeys: Set<String> = remaining,
        suppressions: List<Suppression> = emptyList(),
        active: Set<String?> = emptySet(),
        activatedToday: Int = 0,
        sensitivity: Sensitivity = Sensitivity.NORMAL,
    ) = TriggerEvaluator.judge(kind, slotKey, remainingKeys, suppressions, active, activatedToday, sensitivity, at)

    "남은 일정에 닿으면 발화한다" {
        judge() shouldBe TriggerEvaluator.Verdict.RAISE
    }

    "남은 일정에 없는 슬롯이면 폐기한다(BR-U4-06)" {
        judge(slotKey = "2026-08-11#${UUID.randomUUID()}") shouldBe TriggerEvaluator.Verdict.NOT_AFFECTING
    }

    "날짜 전체 신호는 남은 슬롯이 하나라도 있어야 유효하다" {
        judge(slotKey = null) shouldBe TriggerEvaluator.Verdict.RAISE
        judge(slotKey = null, remainingKeys = emptySet()) shouldBe TriggerEvaluator.Verdict.NOT_AFFECTING
    }

    "같은 사유·같은 슬롯이 이미 떠 있으면 다시 알리지 않는다(BR-U4-07)" {
        judge(active = setOf(slotA)) shouldBe TriggerEvaluator.Verdict.SUPPRESSED
        judge(active = setOf(slotB)) shouldBe TriggerEvaluator.Verdict.RAISE // 다른 슬롯은 별개다
    }

    "사용자가 끈 조합은 더 말하지 않는다(BR-U4-15)" {
        val off = Suppression.of(trip, TriggerKind.WEATHER, slotA, SuppressionScope.SLOT, at)
        judge(suppressions = listOf(off)) shouldBe TriggerEvaluator.Verdict.SUPPRESSED
        judge(slotKey = slotB, suppressions = listOf(off)) shouldBe TriggerEvaluator.Verdict.RAISE // 다른 슬롯
        judge(kind = TriggerKind.DELAY, suppressions = listOf(off)) shouldBe TriggerEvaluator.Verdict.RAISE // 다른 사유
    }

    "DAY 범위 억제는 슬롯을 가리지 않는다" {
        val offDay = Suppression.of(trip, TriggerKind.WEATHER, null, SuppressionScope.DAY, at)
        judge(slotKey = slotA, suppressions = listOf(offDay)) shouldBe TriggerEvaluator.Verdict.SUPPRESSED
        judge(slotKey = slotB, suppressions = listOf(offDay)) shouldBe TriggerEvaluator.Verdict.SUPPRESSED
    }

    "만료된 억제는 없는 것과 같다 — 그래야 재발화가 가능하다(BR-U4-07)" {
        val expired = Suppression.of(
            trip, TriggerKind.WEATHER, slotA, SuppressionScope.SLOT,
            at.minusSeconds(3600), expiresAt = at.minusSeconds(60),
        )
        judge(suppressions = listOf(expired)) shouldBe TriggerEvaluator.Verdict.RAISE
    }

    "하루 총량을 넘으면 발화하지 않는다 — 민감도가 총량을 정한다(BR-U4-08)" {
        judge(activatedToday = 2, sensitivity = Sensitivity.LOW) shouldBe TriggerEvaluator.Verdict.DAILY_CAP
        judge(activatedToday = 2, sensitivity = Sensitivity.NORMAL) shouldBe TriggerEvaluator.Verdict.RAISE
    }

    "무영향이 억제보다 먼저다 — 닿지도 않는 신호를 '껐다'고 기록하면 사실과 다르다" {
        val off = Suppression.of(trip, TriggerKind.WEATHER, slotA, SuppressionScope.SLOT, at)
        judge(slotKey = "2026-08-11#${UUID.randomUUID()}", suppressions = listOf(off)) shouldBe
            TriggerEvaluator.Verdict.NOT_AFFECTING
    }

    // ── 속성 ───────────────────────────────────────────────────────────────
    "발화는 언제나 총량 안에서만 일어난다" {
        checkAll(Arb.int(0..30), Arb.enum<Sensitivity>()) { activated, sensitivity ->
            if (judge(activatedToday = activated, sensitivity = sensitivity) == TriggerEvaluator.Verdict.RAISE) {
                (activated < sensitivity.dailyCap) shouldBe true
            }
        }
    }

    "발화하지 않는 판정은 ACTIVE 상태로 남지 않는다 — 남으면 화면에 노출된다(INV-U4-01)" {
        checkAll(Arb.enum<TriggerEvaluator.Verdict>()) { verdict ->
            if (verdict != TriggerEvaluator.Verdict.RAISE) {
                (verdict.state != TriggerState.ACTIVE) shouldBe true
            }
        }
    }

    "민감도가 높을수록 덜 막는다 — LOW 가 발화하면 NORMAL·HIGH 도 발화한다" {
        checkAll(Arb.int(0..30)) { activated ->
            if (judge(activatedToday = activated, sensitivity = Sensitivity.LOW) == TriggerEvaluator.Verdict.RAISE) {
                judge(activatedToday = activated, sensitivity = Sensitivity.NORMAL) shouldBe TriggerEvaluator.Verdict.RAISE
                judge(activatedToday = activated, sensitivity = Sensitivity.HIGH) shouldBe TriggerEvaluator.Verdict.RAISE
            }
        }
    }
})
