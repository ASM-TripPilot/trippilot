package com.trippilot.reflection.adapter.`in`.event

import com.fasterxml.jackson.databind.ObjectMapper
import com.trippilot.core.event.EventEnvelope
import com.trippilot.reflection.application.TripSummaryNarrator
import com.trippilot.reflection.application.TripSummaryService
import com.trippilot.reflection.domain.DistanceSource
import com.trippilot.reflection.domain.ReflectionSource
import com.trippilot.reflection.domain.TripSummary
import com.trippilot.reflection.domain.TripSummaryStats
import io.kotest.core.spec.style.StringSpec
import io.mockk.every
import io.mockk.mockk
import io.mockk.verify
import io.mockk.verifyOrder
import java.time.Instant
import java.util.UUID

/** 여행 종료 → 규칙 요약을 **먼저** 만들고, 규칙 요약일 때만 AI 회고를 맡긴다(TRIP-1488). */
class TripEndedSubscriberTest : StringSpec({

    val tripId = UUID.randomUUID()
    fun envelope() = EventEnvelope(
        UUID.randomUUID(), "trip.TripEnded", 1, "Trip", tripId.toString(), null, Instant.EPOCH, """{"tripId":"$tripId","endedAt":"x"}""",
    )
    fun summary(source: ReflectionSource) = TripSummary(
        tripId, "요약", emptyList(), TripSummaryStats(0, 0.0, DistanceSource.VISIT_LINE, 0, false), source, Instant.EPOCH,
    )

    "규칙 요약을 저장한 뒤에 AI 회고를 맡긴다" {
        val summaries = mockk<TripSummaryService> { every { generate(tripId) } returns summary(ReflectionSource.RULE) }
        val narrator = mockk<TripSummaryNarrator>(relaxed = true)

        TripEndedSubscriber(summaries, narrator, ObjectMapper()).handle(envelope())

        verifyOrder {
            summaries.generate(tripId)
            narrator.request(tripId)
        }
    }

    "이미 AI 문장이 붙은 요약(재배달)·방문 없는 기본 요약이면 맡기지 않는다" {
        for (source in listOf(ReflectionSource.AI, ReflectionSource.BASIC)) {
            val summaries = mockk<TripSummaryService> { every { generate(tripId) } returns summary(source) }
            val narrator = mockk<TripSummaryNarrator>(relaxed = true)

            TripEndedSubscriber(summaries, narrator, ObjectMapper()).handle(envelope())

            verify(exactly = 0) { narrator.request(any()) }
        }
    }
})
