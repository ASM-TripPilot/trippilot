package com.trippilot.recalculation.application

import com.fasterxml.jackson.databind.ObjectMapper
import com.fasterxml.jackson.module.kotlin.kotlinModule
import com.trippilot.core.error.DomainException
import com.trippilot.core.event.EventEnvelope
import com.trippilot.planbdetection.api.event.DateRisk
import com.trippilot.planbdetection.api.event.PlanBTriggered
import com.trippilot.recalculation.adapter.`in`.event.PlanBTriggeredPrepareSubscriber
import com.trippilot.recalculation.domain.ReplanInitiator
import com.trippilot.recalculation.domain.ReplanStatus
import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.shouldBe
import io.kotest.property.Arb
import io.kotest.property.PropTestConfig
import io.kotest.property.arbitrary.bind
import io.kotest.property.arbitrary.boolean
import io.kotest.property.arbitrary.choice
import io.kotest.property.arbitrary.constant
import io.kotest.property.arbitrary.element
import io.kotest.property.arbitrary.enum
import io.kotest.property.arbitrary.int
import io.kotest.property.arbitrary.list
import io.kotest.property.arbitrary.long
import io.kotest.property.arbitrary.map
import io.kotest.property.arbitrary.string
import io.kotest.property.checkAll
import java.time.Duration
import java.time.Instant
import java.time.LocalDate
import java.util.UUID

/**
 * 선계산의 성질(situation-awareness PBT — 블로킹 게이트).
 *
 * - PBT-SA-14 · INV-SA-6 · INV-U4-06 — 선계산과 사용자 진입이 어떤 순서로 섞여도 여행당 열린 세션은 하나이고,
 *   30분 안에 연 사용자 세션은 선계산이 닫지 않는다. 막지 못하면 사용자가 보던 재계획 화면의 초안이 사라진다.
 * - PBT-SA-15 · INV-SA-1 — 선계산은 어느 경로로도 일정을 쓰지 않는다.
 * - PBT-SA-17 — 계약 위반은 무동작, 재배달은 멱등, 하루 상한, BUSY 는 세션 0.
 */
class PreparedReplanPropertyTest : StringSpec({

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

    "PBT-SA-15 — 선계산 전 과정(해 있음·없음·예외·대체·BUSY)에서 일정 반영(ReplanFacade.apply)은 0회다" {
        checkAll(Arb.enum<Outcome>(), Arb.list(Arb.boolean(), 1..14), Arb.boolean()) { outcome, tomorrows, parkAll ->
            val f = RecalcFixture(today, "07:15")
            when (outcome) {
                Outcome.PROPOSAL -> f.replans.proposal = FakeReplans.sampleProposal(today)
                Outcome.NONE -> f.replans.proposal = null
                Outcome.FAILURE -> f.replans.failWith = IllegalStateException("AI 불통")
            }
            val parked = ParkedExecutor()
            val svc = f.prepared(if (parkAll) parked else DirectExecutor())
            // 같은 여행에 여러 날 위험(대체) + 다른 여행들(쌓아 두면 실행 자리를 넘겨 BUSY 를 만든다)
            tomorrows.forEachIndexed { i, tomorrow ->
                val trip = if (i % 2 == 0) f.tripId else f.trips.add(today.minusDays(1), today.plusDays(1))
                svc.onRisk(f.riskEvent(if (tomorrow) today.plusDays(1) else today, tripId = trip), f.clock.now)
                f.clock.advance(Duration.ofMinutes(1))
            }
            parked.runAll()

            f.replans.applied shouldBe emptyList()
            f.events.published shouldBe emptyList() // 적용 사건(ItineraryRecalculated)도 없다
        }
    }

    "PBT-SA-17 — 임의 payload 의 계약 위반은 예외 없이 무동작이다" {
        checkAll(anyBroken) { payload ->
            val f = RecalcFixture(today, "07:15")
            val subscriber = PlanBTriggeredPrepareSubscriber(f.prepared(), mapper)
            val trigger = f.triggers.add(f.tripId, today)

            subscriber.handle(envelope(payload.bind(f, trigger), trigger.toString(), f.clock.now))

            f.sessions.stored shouldBe emptyMap()
            f.replans.commands shouldBe emptyList()
        }
    }

    "PBT-SA-17 — 같은 봉투가 N 번 와도 SYSTEM 세션은 하나다(at-least-once 멱등)" {
        checkAll(Arb.int(1..6), Arb.boolean()) { n, tomorrow ->
            val f = RecalcFixture(today, "07:15")
            val subscriber = PlanBTriggeredPrepareSubscriber(f.prepared(), mapper)
            val trigger = f.triggers.add(f.tripId, if (tomorrow) today.plusDays(1) else today)
            val delivered = envelope(validPayload(f, trigger), trigger.toString(), f.clock.now)

            repeat(n) { subscriber.handle(delivered) }

            f.sessions.system().size shouldBe 1
            f.replans.commands.size shouldBe 1 // 재배달은 AI 를 다시 부르지 않는다
        }
    }

    "PBT-SA-17 — 하루 선계산은 여행당 3·전체 100 을 넘지 않는다(연 세션만 센다)" {
        checkAll(PropTestConfig(iterations = 40), Arb.int(1..130), Arb.int(1..8)) { tripCount, perTrip ->
            val f = RecalcFixture(today, "07:15")
            val svc = f.prepared()
            val trips = (1..tripCount).map { f.trips.add(today.minusDays(1), today.plusDays(1)) }
            // 같은 날 위험이 회차마다 새로 선다 — 같은 날 선계산은 닫고 다시 열리므로 막는 것은 상한뿐이다
            repeat(perTrip) {
                trips.forEach { trip -> svc.onRisk(f.riskEvent(today, tripId = trip), f.clock.now) }
                f.clock.advance(Duration.ofMinutes(1))
            }

            f.sessions.system().groupBy { it.tripId }.values.all { it.size <= 3 } shouldBe true
            (f.sessions.system().size <= 100) shouldBe true
            // 꽉 채운다 — 상한이 과하게 막지도 않는다(여행 3 · 전체 100 중 작은 쪽까지는 연다)
            f.sessions.system().size shouldBe minOf(100, tripCount * minOf(3, perTrip))
        }
    }

    "PBT-SA-17 — 실행 자리를 못 얻으면(BUSY) 세션을 열지 않는다" {
        checkAll(Arb.int(12..40)) { events ->
            val f = RecalcFixture(today, "07:15")
            val parked = ParkedExecutor()
            val svc = f.prepared(parked)

            repeat(events) { svc.onRisk(f.riskEvent(today, tripId = f.trips.add(today.minusDays(1), today.plusDays(1))), f.clock.now) }

            f.sessions.system().size shouldBe PreparedReplanService.RUNNING + PreparedReplanService.WAITING
            parked.parked.size shouldBe f.sessions.system().size
        }
    }
}) {
    private sealed interface Op {
        data class Prepare(val tomorrow: Boolean, val reuse: Boolean) : Op
        data class Start(val withTrigger: Boolean, val tomorrow: Boolean) : Op
        data class Advance(val minutes: Long) : Op
        data object Solve : Op
    }

    private enum class Outcome { PROPOSAL, NONE, FAILURE }

    /** 계약을 어긴 payload 의 틀 — [bind] 가 그 여행·트리거의 실제 id 를 채운다(남의 것이라 무동작인 경우와 갈라 두려고). */
    private class Broken(val template: String) {
        fun bind(f: RecalcFixture, trigger: UUID) =
            template.replace("{acc}", f.acc.toString()).replace("{trip}", f.tripId.toString()).replace("{trigger}", trigger.toString())
    }

    private companion object {
        private val today = LocalDate.parse("2026-08-11")
        private val mapper = ObjectMapper().registerModule(kotlinModule())

        private fun envelope(payload: String, aggregateId: String, at: Instant) =
            EventEnvelope(UUID.randomUUID(), "planb.PlanBTriggered", 1, "PlanBTrigger", aggregateId, null, at, payload)

        /** 발행측 DTO 를 실제로 직렬화한 유효한 위험 사건. */
        private fun validPayload(f: RecalcFixture, trigger: UUID): String = mapper.writeValueAsString(
            PlanBTriggered(
                trigger.toString(), f.acc.toString(), f.tripId.toString(), "WEATHER", null, "비 소식이 있어요.",
                affectedDate = today.toString(), scope = "PARTIAL_SLOTS", severity = "RISK", variant = "RAIN",
                push = true, others = 0, dateRisks = listOf(DateRisk("WEATHER", "RAIN", emptyList())),
            ),
        )

        private const val RISKS = """[{"kind":"WEATHER","variant":"RAIN","poiIds":[]}]"""

        /** 유효한 위험 사건의 한 군데를 깬 것들. */
        private val brokenTemplates = listOf(
            """{"severity":"RISK","accountId":"{acc}","tripId":"{trip}","dateRisks":[]}""",
            """{"severity":"RISK","accountId":"{acc}","tripId":"{trip}"}""",
            """{"severity":"RISK","accountId":"{acc}","tripId":"{trip}","dateRisks":{"kind":"CLOSURE"}}""",
            """{"severity":"RISK","accountId":"","tripId":"{trip}","dateRisks":$RISKS}""",
            """{"severity":"RISK","accountId":"{acc}","tripId":7,"dateRisks":$RISKS}""",
            """{"severity":"RISK","accountId":"{acc}","tripId":"{trip}","dateRisks":[null]}""",
            """{"severity":"RISK","accountId":"{acc}","tripId":"{trip}","dateRisks":[{"kind":7,"poiIds":[]}]}""",
            """{"severity":"RISK","accountId":"{acc}","tripId":"{trip}","dateRisks":[{"kind":"CLOSURE"}]}""",
            """{"severity":"RISK","accountId":"{acc}","tripId":"{trip}","dateRisks":[{"kind":"CLOSURE","poiIds":["{trip}","x"]}]}""",
            """{"severity":"RISK","accountId":"{acc}","tripId":"{trip}","dateRisks":[{"kind":"CLOSURE","poiIds":[1]}]}""",
            """{"severity":"RISK"""",
            "null",
            "",
        )

        /** 깬 사건과 무작위 문자열을 섞는다 — 무작위 문자열은 자리표시자가 없어 그대로 나간다. */
        private val anyBroken: Arb<Broken> = Arb.choice(
            Arb.element(brokenTemplates).map { Broken(it) },
            Arb.string(0..80).map { Broken(it) },
        )

        private val op: Arb<Op> = Arb.choice(
            Arb.bind(Arb.boolean(), Arb.boolean()) { t, r -> Op.Prepare(t, r) },
            Arb.bind(Arb.boolean(), Arb.boolean()) { w, t -> Op.Start(w, t) },
            Arb.long(0L..90L).map { Op.Advance(it) },
            Arb.constant(Op.Solve),
        )
    }
}
