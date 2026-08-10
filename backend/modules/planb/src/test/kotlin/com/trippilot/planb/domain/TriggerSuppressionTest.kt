package com.trippilot.planb.domain

import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.shouldBe
import io.kotest.property.Arb
import io.kotest.property.arbitrary.bind
import io.kotest.property.arbitrary.enum
import io.kotest.property.arbitrary.int
import io.kotest.property.arbitrary.list
import io.kotest.property.checkAll
import java.time.Instant
import java.util.UUID

/**
 * 억제 판정(US-PLANB-02 · C9). 감지와 분리돼 있어 외부 신호 없이 그 자체로 검증된다.
 *
 * 지키려는 것: 같은 사실을 반복해 알리지 않는다 · 사용자가 닫으면 더 말하지 않는다 · 하루 총량을 넘지 않는다.
 * 이 세 가지가 무너지면 사용자는 배너를 무시하게 되고, 그러면 정작 중요한 신호도 함께 묻힌다.
 */
class TriggerSuppressionTest : StringSpec({

    val trip = UUID.randomUUID()
    val at = Instant.parse("2026-08-11T00:00:00Z")
    fun event(status: TriggerStatus) = TriggerEvent(
        UUID.randomUUID(), trip, TriggerType.WEATHER, null, "강수확률 80%", status, at, at,
    )

    "이력이 없고 여유가 있으면 알린다" {
        TriggerSuppression.judge(emptyList(), raisedToday = 0, Sensitivity.NORMAL) shouldBe
            TriggerSuppression.Verdict.RAISE
    }

    "이미 알리는 중이면 다시 알리지 않는다 — 배너만 둘로 늘 뿐 새 정보가 없다" {
        TriggerSuppression.judge(listOf(event(TriggerStatus.ACTIVE)), 0, Sensitivity.HIGH) shouldBe
            TriggerSuppression.Verdict.ALREADY_ACTIVE
    }

    "사용자가 닫았으면 더 말하지 않는다" {
        TriggerSuppression.judge(listOf(event(TriggerStatus.DISMISSED)), 0, Sensitivity.HIGH) shouldBe
            TriggerSuppression.Verdict.USER_DISMISSED
    }

    "해소된 이력만 있으면 다시 알릴 수 있다 — 상황이 재발한 것이다" {
        // NORMAL(해소)과 DISMISSED(사용자가 닫음)를 구분하는 이유가 이것이다.
        TriggerSuppression.judge(listOf(event(TriggerStatus.NORMAL)), 0, Sensitivity.NORMAL) shouldBe
            TriggerSuppression.Verdict.RAISE
    }

    "하루 총량을 넘으면 알리지 않는다 — 민감도가 총량을 정한다" {
        TriggerSuppression.judge(emptyList(), raisedToday = 2, Sensitivity.LOW) shouldBe
            TriggerSuppression.Verdict.DAILY_CAP
        TriggerSuppression.judge(emptyList(), raisedToday = 2, Sensitivity.NORMAL) shouldBe
            TriggerSuppression.Verdict.RAISE // 같은 상황이라도 민감도가 높으면 알린다
    }

    "닫힘이 활성보다 우선하지 않는다 — 둘 다 있으면 '이미 알리는 중'이 먼저다" {
        // 사용자가 닫은 뒤 상황이 재발해 다시 떴다면, 지금 화면에 떠 있는 것이 사실이다.
        TriggerSuppression.judge(
            listOf(event(TriggerStatus.DISMISSED), event(TriggerStatus.ACTIVE)), 0, Sensitivity.HIGH,
        ) shouldBe TriggerSuppression.Verdict.ALREADY_ACTIVE
    }

    // ── 속성 ───────────────────────────────────────────────────────────────
    "활성 이력이 하나라도 있으면 어떤 조합에서도 새로 알리지 않는다" {
        checkAll(
            Arb.list(Arb.enum<TriggerStatus>(), 0..6),
            Arb.int(0..20),
            Arb.enum<Sensitivity>(),
        ) { statuses, raised, sensitivity ->
            val history = statuses.map { event(it) }
            val verdict = TriggerSuppression.judge(history, raised, sensitivity)
            if (history.any { it.status == TriggerStatus.ACTIVE }) {
                verdict shouldBe TriggerSuppression.Verdict.ALREADY_ACTIVE
            }
            // 어떤 경우에도 판정은 나온다(침묵 금지 — 알리지 않기로 했다면 사유가 있다)
            (verdict in TriggerSuppression.Verdict.entries) shouldBe true
        }
    }

    "RAISE 는 총량 안에서만 나온다 — 상한을 넘겨 알리는 경우가 없다" {
        checkAll(Arb.int(0..30), Arb.enum<Sensitivity>()) { raised, sensitivity ->
            val verdict = TriggerSuppression.judge(emptyList(), raised, sensitivity)
            if (verdict == TriggerSuppression.Verdict.RAISE) {
                (raised < sensitivity.dailyCap) shouldBe true
            }
        }
    }

    "민감도가 높을수록 덜 억제한다 — 같은 상황에서 LOW 가 알리면 NORMAL·HIGH 도 알린다" {
        checkAll(Arb.int(0..30)) { raised ->
            val low = TriggerSuppression.judge(emptyList(), raised, Sensitivity.LOW)
            if (low == TriggerSuppression.Verdict.RAISE) {
                TriggerSuppression.judge(emptyList(), raised, Sensitivity.NORMAL) shouldBe
                    TriggerSuppression.Verdict.RAISE
                TriggerSuppression.judge(emptyList(), raised, Sensitivity.HIGH) shouldBe
                    TriggerSuppression.Verdict.RAISE
            }
        }
    }
})
