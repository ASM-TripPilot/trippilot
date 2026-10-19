package com.trippilot.recalculation.application

import com.trippilot.core.error.DomainException
import com.trippilot.recalculation.domain.ReplanInitiator
import com.trippilot.recalculation.domain.ReplanStatus
import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.shouldBe
import io.kotest.property.Arb
import io.kotest.property.arbitrary.bind
import io.kotest.property.arbitrary.boolean
import io.kotest.property.arbitrary.choice
import io.kotest.property.arbitrary.constant
import io.kotest.property.arbitrary.list
import io.kotest.property.arbitrary.long
import io.kotest.property.arbitrary.map
import io.kotest.property.checkAll
import java.time.Duration
import java.time.LocalDate
import java.util.UUID

/**
 * 선계산의 성질(situation-awareness PBT — 블로킹 게이트).
 *
 * PBT-SA-14 · INV-SA-6 · INV-U4-06 — 선계산과 사용자 진입이 어떤 순서로 섞여도 여행당 열린 세션은 하나이고,
 * 30분 안에 연 사용자 세션은 선계산이 닫지 않는다. 막지 못하면 사용자가 보던 재계획 화면의 초안이 사라진다.
 */
class PreparedReplanPropertyTest : StringSpec({

    val today = LocalDate.parse("2026-08-11")

    "PBT-SA-14 — 임의의 선계산·사용자 진입 순서 뒤 열린 세션 ≤ 1, 30분 안 사용자 세션은 선계산이 닫지 않는다" {
        checkAll(Arb.list(op, 1..25)) { ops ->
            val f = RecalcFixture(today, "07:15")
            val triggers = mutableListOf<UUID>()

            for (o in ops) {
                val openUser = f.sessions.openOf(f.tripId).singleOrNull()
                    ?.takeIf { it.initiatedBy == ReplanInitiator.USER && Duration.between(it.createdAt, f.clock.now) < Duration.ofMinutes(30) }
                val day = LocalDate.ofInstant(f.clock.now, KST)
                when (o) {
                    is Op.Prepare -> {
                        val trigger = triggers.lastOrNull()?.takeIf { o.reuse }
                            ?: f.triggers.add(f.tripId, if (o.tomorrow) day.plusDays(1) else day).also { triggers += it }
                        f.prepare(trigger)
                        // INV-SA-6 — 사용자가 보는 중인 세션은 선계산이 닫지 않는다
                        openUser?.let { f.sessions.stored.getValue(it.sessionId).isOpen shouldBe true }
                    }
                    is Op.Start -> {
                        val trigger = if (o.withTrigger) f.triggers.add(f.tripId, if (o.tomorrow) day.plusDays(1) else day) else null
                        try {
                            f.startUser(triggerId = trigger)
                        } catch (expected: DomainException) {
                            // 여행이 끝났거나 그 날 일정이 없다 — 진입 거절은 정상 동작이다(세션을 열지 않는다)
                        }
                    }
                    is Op.Advance -> f.clock.advance(Duration.ofMinutes(o.minutes))
                    Op.Solve -> f.sessions.openOf(f.tripId).singleOrNull()
                        ?.takeIf { it.status == ReplanStatus.SOLVING }
                        ?.let { f.solver.solveNow(f.acc, it.sessionId) }
                }
                // INV-U4-06 — 대역은 둘째 열린 세션 저장을 예외로 막는다. 여기까지 왔으면 서비스가 먼저 닫았다는 뜻이고, 다시 센다.
                (f.sessions.openOf(f.tripId).size <= 1) shouldBe true
            }
        }
    }
}) {
    private sealed interface Op {
        data class Prepare(val tomorrow: Boolean, val reuse: Boolean) : Op
        data class Start(val withTrigger: Boolean, val tomorrow: Boolean) : Op
        data class Advance(val minutes: Long) : Op
        data object Solve : Op
    }

    private companion object {
        private val op: Arb<Op> = Arb.choice(
            Arb.bind(Arb.boolean(), Arb.boolean()) { t, r -> Op.Prepare(t, r) },
            Arb.bind(Arb.boolean(), Arb.boolean()) { w, t -> Op.Start(w, t) },
            Arb.long(0L..90L).map { Op.Advance(it) },
            Arb.constant(Op.Solve),
        )
    }
}
