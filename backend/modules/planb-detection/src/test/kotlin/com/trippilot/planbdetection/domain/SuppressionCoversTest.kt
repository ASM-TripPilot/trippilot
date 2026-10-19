package com.trippilot.planbdetection.domain

import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.shouldBe
import io.kotest.property.Arb
import io.kotest.property.arbitrary.element
import io.kotest.property.arbitrary.enum
import io.kotest.property.checkAll
import java.time.Instant
import java.time.LocalDate
import java.util.UUID

/**
 * 억제 범위(규칙 10 · O1) — [끄기] 는 끈 트리거의 날짜·심각도까지만 덮는다.
 * 주의를 끈 것이 같은 대상의 위험 격상을, 오늘을 끈 것이 내일 대상을 막지 않는다.
 * 날짜·심각도가 없는 옛 행은 종전과 똑같이 덮는다(이미 저장된 억제·롤링 배포 보호).
 */
class SuppressionCoversTest : StringSpec({

    val trip = UUID.randomUUID()
    val at = Instant.parse("2026-10-20T03:00:00Z")
    val day = LocalDate.parse("2026-10-20")
    val slots = listOf<String?>(null, "$day#a", "$day#b")
    val dates = listOf(day, day.plusDays(1))

    /** SLOT 범위는 슬롯이 꼭 있어야 한다(도메인 require) — 없으면 `$day#a` 로 채운다. */
    fun off(kind: TriggerKind, scope: SuppressionScope, slotKey: String?, date: LocalDate?, max: TriggerSeverity?) =
        Suppression(
            UUID.randomUUID(), trip, kind, if (scope == SuppressionScope.SLOT) slotKey ?: "$day#a" else slotKey,
            scope, at, null, date, max,
        )

    "예 — SLOT 은 그 슬롯만, DAY 는 그 날만, TRIP 은 전부, 심각도는 끈 것 이하만" {
        val slot = off(TriggerKind.CLOSURE, SuppressionScope.SLOT, "$day#a", day, TriggerSeverity.RISK)
        slot.covers(TriggerKind.CLOSURE, "$day#a", day, TriggerSeverity.RISK) shouldBe true
        slot.covers(TriggerKind.CLOSURE, "$day#b", day, TriggerSeverity.RISK) shouldBe false
        slot.covers(TriggerKind.WEATHER, "$day#a", day, TriggerSeverity.RISK) shouldBe false

        val dayOff = off(TriggerKind.WEATHER, SuppressionScope.DAY, null, day, TriggerSeverity.CAUTION)
        dayOff.covers(TriggerKind.WEATHER, "$day#a", day, TriggerSeverity.CAUTION) shouldBe true
        dayOff.covers(TriggerKind.WEATHER, null, day, TriggerSeverity.RISK) shouldBe false
        dayOff.covers(TriggerKind.WEATHER, null, day.plusDays(1), TriggerSeverity.CAUTION) shouldBe false

        val tripOff = off(TriggerKind.WEATHER, SuppressionScope.TRIP, null, null, null)
        tripOff.covers(TriggerKind.WEATHER, "$day#b", day.plusDays(1), TriggerSeverity.RISK) shouldBe true
    }

    "주의를 끈 억제는 같은 대상의 위험을 막지 않는다 (T-D1-P6)" {
        checkAll(Arb.enum<TriggerKind>(), Arb.element(slots), Arb.element(dates), Arb.enum<SuppressionScope>()) { kind, slot, date, scope ->
            off(kind, scope, slot, date, TriggerSeverity.CAUTION).covers(kind, slot, date, TriggerSeverity.RISK) shouldBe false
        }
    }

    "오늘 DAY 억제는 내일 대상을 막지 않는다 (T-D1-P6)" {
        checkAll(Arb.enum<TriggerKind>(), Arb.element(slots), Arb.enum<TriggerSeverity>()) { kind, slot, severity ->
            val today = off(kind, SuppressionScope.DAY, null, day, TriggerSeverity.RISK)
            today.covers(kind, slot, day.plusDays(1), severity) shouldBe false
            today.covers(kind, slot, day, severity) shouldBe true
        }
    }

    "날짜·심각도가 없는 옛 억제는 종전처럼 덮는다 (T-D1-P6)" {
        checkAll(
            Arb.enum<TriggerKind>(), Arb.enum<TriggerKind>(), Arb.enum<SuppressionScope>(),
            Arb.element(slots), Arb.element(slots), Arb.element(dates), Arb.enum<TriggerSeverity>(),
        ) { offKind, kind, scope, offSlot, slot, date, severity ->
            val legacy = off(offKind, scope, offSlot, null, null)
            // 종전 정의: 같은 kind ∧ (SLOT 이면 같은 슬롯)
            val before = legacy.kind == kind && (scope != SuppressionScope.SLOT || legacy.slotKey == slot)
            legacy.covers(kind, slot, date, severity) shouldBe before
        }
    }
})
