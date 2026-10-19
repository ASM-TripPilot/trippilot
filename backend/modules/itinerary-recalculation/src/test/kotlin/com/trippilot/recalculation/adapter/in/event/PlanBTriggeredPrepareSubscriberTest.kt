package com.trippilot.recalculation.adapter.`in`.event

import com.fasterxml.jackson.databind.ObjectMapper
import com.fasterxml.jackson.module.kotlin.kotlinModule
import com.trippilot.core.event.EventEnvelope
import com.trippilot.planbdetection.api.event.DateRisk
import com.trippilot.planbdetection.api.event.PlanBTriggered
import com.trippilot.recalculation.application.RecalcFixture
import com.trippilot.recalculation.application.prepared
import com.trippilot.recalculation.domain.ReplanSession
import com.trippilot.recalculation.domain.ReplanSessionRepository
import io.kotest.assertions.throwables.shouldThrow
import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.collections.shouldContainExactly
import io.kotest.matchers.shouldBe
import org.springframework.dao.DataAccessResourceFailureException
import java.time.Instant
import java.time.LocalDate
import java.util.UUID

/**
 * 선계산 구독자(CD19) — 사건을 읽어 선계산에 넘긴다. 계약 위반은 삼키고, 일시 오류는 던진다.
 *
 * payload 는 **발행측 DTO 를 실제로 직렬화한 것**으로 만든다 — 키 이름(`severity`·`dateRisks`·`poiIds`·`coverage`)이
 * 한 글자만 달라도 구독자는 조용히 옛 사건으로 읽는다(아무것도 안 하고 초록).
 */
class PlanBTriggeredPrepareSubscriberTest : StringSpec({

    val today = LocalDate.parse("2026-08-11")
    val mapper = ObjectMapper().registerModule(kotlinModule())

    fun envelope(payload: String, aggregateId: String, at: Instant) =
        EventEnvelope(UUID.randomUUID(), "planb.PlanBTriggered", 1, "PlanBTrigger", aggregateId, null, at, payload)

    fun riskEnvelope(f: RecalcFixture, trigger: UUID, risks: List<DateRisk>, severity: String? = "RISK") = envelope(
        mapper.writeValueAsString(
            PlanBTriggered(
                trigger.toString(), f.acc.toString(), f.tripId.toString(), "WEATHER", null, "오후에 비 소식이 있어요.",
                affectedDate = today.toString(), scope = "PARTIAL_SLOTS", severity = severity, variant = "RAIN",
                push = true, others = 0, dateRisks = risks,
            ),
        ),
        trigger.toString(), f.clock.now,
    )

    "위험 사건이면 그 날 위험을 재료로 선계산한다 — 발행측 키 이름 그대로 읽는다" {
        val f = RecalcFixture(today, "07:15")
        val trigger = f.triggers.add(f.tripId, today)
        val closed = UUID.randomUUID()
        val wet = UUID.randomUUID()

        PlanBTriggeredPrepareSubscriber(f.prepared(), mapper).handle(
            riskEnvelope(
                f, trigger,
                listOf(DateRisk("CLOSURE", "CLOSED_DAY", listOf(closed.toString())), DateRisk("WEATHER", "HEAT", listOf(wet.toString()), "SOME")),
            ),
        )

        val s = f.sessions.system().single()
        s.triggerId shouldBe trigger
        s.reasons shouldContainExactly listOf("TEMP_CLOSED", "WEATHER")
        s.directives shouldContainExactly listOf("AVOID_OUTDOOR")
        s.excludedPoiIds shouldContainExactly listOf(closed, wet)
    }

    "옛 사건(새 필드 전)과 주의 사건은 선계산하지 않는다" {
        val f = RecalcFixture(today, "07:15")
        val subscriber = PlanBTriggeredPrepareSubscriber(f.prepared(), mapper)
        val old = f.triggers.add(f.tripId, today)
        val caution = f.triggers.add(f.tripId, today)

        subscriber.handle(
            envelope(
                mapper.writeValueAsString(PlanBTriggered(old.toString(), f.acc.toString(), f.tripId.toString(), "WEATHER", null, "비 예보 70%")),
                old.toString(), f.clock.now,
            ),
        )
        // 대표가 주의여도 그 날 이미 떠 있던 위험이 항목에 실린다 — 대표로 거르지 않으면 주의 알림마다 초안을 갈아 끼운다.
        subscriber.handle(riskEnvelope(f, caution, listOf(DateRisk("WEATHER", "RAIN", emptyList())), severity = "CAUTION"))

        f.sessions.stored shouldBe emptyMap()
    }

    "계약 위반은 WARN 후 삼킨다 — 재시도해도 같은 값이라 던지지 않는다" {
        val f = RecalcFixture(today, "07:15")
        val subscriber = PlanBTriggeredPrepareSubscriber(f.prepared(), mapper)
        val trigger = f.triggers.add(f.tripId, today).toString()
        val acc = f.acc.toString()
        val trip = f.tripId.toString()
        val risk = """[{"kind":"WEATHER","variant":"RAIN","poiIds":[]}]"""

        listOf(
            "{not json" to trigger,
            "[1,2]" to trigger,
            """{"severity":"RISK","accountId":"x","tripId":"$trip","dateRisks":$risk}""" to trigger,
            """{"severity":"RISK","accountId":"$acc","tripId":"$trip","dateRisks":$risk}""" to "not-a-uuid",
            """{"severity":"RISK","accountId":"$acc","tripId":"$trip"}""" to trigger,
            """{"severity":"RISK","accountId":"$acc","tripId":"$trip","dateRisks":[]}""" to trigger,
            """{"severity":"RISK","accountId":"$acc","tripId":"$trip","dateRisks":[{"variant":"RAIN","poiIds":[]}]}""" to trigger,
            """{"severity":"RISK","accountId":"$acc","tripId":"$trip","dateRisks":[{"kind":"CLOSURE","poiIds":["nope"]}]}""" to trigger,
            """{"severity":"RISK","accountId":"$acc","tripId":"$trip","dateRisks":[{"kind":"CLOSURE","poiIds":"x"}]}""" to trigger,
        ).forEach { (payload, aggregate) -> subscriber.handle(envelope(payload, aggregate, f.clock.now)) }

        f.sessions.stored shouldBe emptyMap()
    }

    "일시 오류는 던진다 — 릴레이가 이벤트째 다시 배달하고 트리거당 1개가 재배달을 받아 넘긴다" {
        val f = RecalcFixture(today, "07:15")
        val real = f.sessions
        var down = true
        f.repository = object : ReplanSessionRepository by real {
            override fun findSystemByTrigger(triggerId: UUID): ReplanSession? =
                if (down) throw DataAccessResourceFailureException("커넥션 없음") else real.findSystemByTrigger(triggerId)
        }
        val subscriber = PlanBTriggeredPrepareSubscriber(f.prepared(), mapper)
        val delivered = riskEnvelope(f, f.triggers.add(f.tripId, today), listOf(DateRisk("WEATHER", "RAIN", emptyList())))

        shouldThrow<DataAccessResourceFailureException> { subscriber.handle(delivered) }
        down = false
        subscriber.handle(delivered)
        subscriber.handle(delivered) // 성공 뒤 재배달(다른 구독자가 실패한 경우) — 세션은 그대로 하나다

        f.sessions.system().size shouldBe 1
    }
})
