package com.trippilot.planbdetection.adapter.`in`.event

import com.fasterxml.jackson.databind.ObjectMapper
import com.trippilot.core.event.EventEnvelope
import com.trippilot.itinerarygeneration.api.ItineraryFacade
import com.trippilot.planbdetection.application.InMemoryTriggers
import com.trippilot.planbdetection.application.triggerService
import com.trippilot.planbdetection.domain.PlanBTrigger
import com.trippilot.planbdetection.domain.TriggerKind
import com.trippilot.planbdetection.domain.TriggerScope
import com.trippilot.planbdetection.domain.TriggerState
import com.trippilot.trip.api.TripFacade
import io.kotest.assertions.throwables.shouldThrow
import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.shouldBe
import java.time.Clock
import java.time.Instant
import java.time.LocalDate
import java.util.UUID

/** 재계획 적용 → 트리거 소비(규칙 16). payload 를 트리로 읽고, 못 고칠 값은 삼키고 고칠 수 있는 실패만 올린다(CD19). */
class ReplanAppliedSubscriberTest : StringSpec({

    val tripId = UUID.randomUUID()
    val day = LocalDate.parse("2026-08-11")
    val noTrips = object : TripFacade {
        override fun findPeriod(accountId: UUID, tripId: UUID) = null
        override fun findGenerationContext(accountId: UUID, tripId: UUID) = null
    }
    val noItineraries = object : ItineraryFacade {
        override fun findCurrent(accountId: UUID, tripId: UUID) = null
    }

    fun fixture(): Pair<InMemoryTriggers, ReplanAppliedSubscriber> {
        val triggers = InMemoryTriggers()
        val service = triggerService(noTrips, noItineraries, Clock.systemUTC(), triggers)
        return triggers to ReplanAppliedSubscriber(service, ObjectMapper())
    }

    fun envelope(payload: String, aggregateId: String = tripId.toString()) = EventEnvelope(
        UUID.randomUUID(), "recalculation.ItineraryRecalculated", 1, "Trip", aggregateId, null, Instant.EPOCH, payload,
    )

    fun activeIn(triggers: InMemoryTriggers) = triggers.save(
        PlanBTrigger.active(tripId, UUID.randomUUID(), TriggerKind.WEATHER, day, null, emptyMap(), TriggerScope.FULL_DAY, "비 소식", Instant.EPOCH),
    )

    "트리거 진입 재계획이 그 날짜에 적용되면 그 트리거를 소비한다" {
        val (triggers, subscriber) = fixture()
        val t = activeIn(triggers)
        subscriber.handle(envelope("""{"aggregateId":"$tripId","replanSessionId":"${UUID.randomUUID()}","triggerId":"${t.triggerId}","targetDate":"$day"}"""))
        triggers.findById(t.triggerId)!!.state shouldBe TriggerState.CONSUMED
    }

    "수동 재계획·날짜 없는 옛 사건·형식이 어긋난 값은 아무것도 하지 않는다 — 재시도해도 풀리지 않는다" {
        val (triggers, subscriber) = fixture()
        val t = activeIn(triggers)
        subscriber.handle(envelope("""{"aggregateId":"$tripId","replanSessionId":"s","triggerId":null}"""))
        subscriber.handle(envelope("""{"aggregateId":"$tripId","replanSessionId":"s","triggerId":"${t.triggerId}"}"""))
        subscriber.handle(envelope("""{"aggregateId":"$tripId","replanSessionId":"s","triggerId":"not-a-uuid","targetDate":"$day"}"""))
        subscriber.handle(envelope("""{"aggregateId":"$tripId","replanSessionId":"s","triggerId":"${t.triggerId}","targetDate":"8월 11일"}"""))
        triggers.findById(t.triggerId)!!.state shouldBe TriggerState.ACTIVE
    }

    "여행을 못 읽거나 payload 가 JSON 이 아니면 예외로 올린다 — 릴레이가 재시도하고 상한에서 error 로 남긴다" {
        val (_, subscriber) = fixture()
        shouldThrow<IllegalStateException> { subscriber.handle(envelope("{}", aggregateId = "not-a-trip")) }
        shouldThrow<IllegalStateException> { subscriber.handle(envelope("not json")) }
    }
})
