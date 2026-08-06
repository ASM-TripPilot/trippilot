package com.trippilot.itinerarygeneration.application

import com.trippilot.itinerarygeneration.domain.FreshnessMeta
import com.trippilot.itinerarygeneration.domain.GenerationMode
import com.trippilot.itinerarygeneration.domain.Itinerary
import com.trippilot.itinerarygeneration.domain.ItineraryRepository
import com.trippilot.itinerarygeneration.domain.RepairResult
import com.trippilot.itinerarygeneration.domain.ScheduleAgentInput
import com.trippilot.itinerarygeneration.domain.ScheduleAgentOutput
import com.trippilot.itinerarygeneration.domain.ScheduleAgentPort
import com.trippilot.itinerarygeneration.domain.SolveMode
import com.trippilot.itinerarygeneration.domain.Violation
import com.trippilot.profile.api.PreferenceFacade
import com.trippilot.profile.api.PreferenceSnapshot
import com.trippilot.savedaccommodation.api.BaseAnchorFacade
import com.trippilot.savedaccommodation.api.DayAnchorView
import com.trippilot.trip.api.FixedVisit
import com.trippilot.trip.api.TripFacade
import com.trippilot.trip.api.TripGenerationContext
import com.trippilot.trip.api.TripPeriod
import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.collections.shouldContainExactly
import io.kotest.matchers.shouldBe
import java.time.Clock
import java.time.Instant
import java.time.LocalDate
import java.time.LocalTime
import java.time.ZoneOffset
import java.util.UUID

private class CapturingAgent(private val now: Instant) : ScheduleAgentPort {
    var captured: ScheduleAgentInput? = null
    override fun generate(input: ScheduleAgentInput): ScheduleAgentOutput {
        captured = input
        return ScheduleAgentOutput(
            days = emptyList(), day1ReadyAt = null, explanations = emptyMap(),
            solveMode = SolveMode.DETERMINISTIC, isFallback = false,
            freshness = FreshnessMeta(now, degraded = false),
        )
    }
    override fun validate(solution: ScheduleAgentOutput): List<Violation> = emptyList()
    override fun repair(solution: ScheduleAgentOutput, violations: List<Violation>) = RepairResult(solution, emptyList())
}

/** ScheduleAgent(AI) 실패 재현 — INV-4 폴백 경로 검증용. */
private class ThrowingAgent : ScheduleAgentPort {
    override fun generate(input: ScheduleAgentInput): ScheduleAgentOutput = throw RuntimeException("agent down")
    override fun validate(solution: ScheduleAgentOutput): List<Violation> = emptyList()
    override fun repair(solution: ScheduleAgentOutput, violations: List<Violation>) = RepairResult(solution, emptyList())
}

private class FakeItineraries : ItineraryRepository {
    override fun save(itinerary: Itinerary): Itinerary = itinerary
    override fun findById(itineraryId: UUID): Itinerary? = null
    override fun findByTrip(tripId: UUID): List<Itinerary> = emptyList()
    override fun replaceForTrip(tripId: UUID, itinerary: Itinerary): Itinerary = itinerary
}

/**
 * 컨텍스트 조립 검증 — 캡처 에이전트로 ScheduleAgentInput 을 붙잡아 취향(7축)·budgetLevel·앵커 조립을 고정.
 * 앵커 체크아웃일(endDate)=전날 거점(prev_stay) 파생·미해결일 제외를 포함.
 */
class GenerateItineraryServiceTest : StringSpec({

    val now = Instant.parse("2026-08-06T00:00:00Z")
    val clock = Clock.fixed(now, ZoneOffset.UTC)
    val acc = UUID.randomUUID()
    val tripId = UUID.randomUUID()
    val poi = UUID.randomUUID()
    val start = LocalDate.parse("2026-08-01")
    val end = LocalDate.parse("2026-08-03") // 계획일 08-01·02·03, 숙박일 08-01·02

    fun service(agent: ScheduleAgentPort, prefs: PreferenceSnapshot, anchors: List<DayAnchorView>): GenerateItineraryService {
        val trips = object : TripFacade {
            override fun findPeriod(accountId: UUID, tripId: UUID) = TripPeriod(start, end)
            override fun findGenerationContext(accountId: UUID, tripId: UUID) =
                if (accountId == acc) {
                    TripGenerationContext(
                        start, end, listOf("제주"), "친구", 500_000,
                        listOf(FixedVisit(poi, start, LocalTime.parse("12:00"), 90)),
                    )
                } else {
                    null
                }
        }
        val preferences = object : PreferenceFacade {
            override fun findPreferences(accountId: UUID) = prefs
        }
        val baseAnchors = object : BaseAnchorFacade {
            override fun findStayNightAnchors(accountId: UUID, tripId: UUID) = anchors
        }
        return GenerateItineraryService(trips, preferences, baseAnchors, agent, FakeItineraries(), clock)
    }

    val fullPrefs = PreferenceSnapshot(
        styles = listOf("미식"), activities = listOf("야경"), foodTastes = listOf("한식"),
        transportModes = listOf("렌터카"), pace = "알차게", companionTypes = listOf("친구"),
        petFriendly = true, budgetTier = "고급",
    )

    "취향 7축·budgetLevel(=budget_tier)·must_visit 고정블록 조립" {
        val agent = CapturingAgent(now)
        service(agent, fullPrefs, emptyList()).generate(acc, tripId, GenerationMode.FULLY_AI)
        val input = agent.captured!!
        input.tripContext.budgetLevel shouldBe "고급"
        input.preferenceProfile.styles shouldBe listOf("미식")
        input.preferenceProfile.transportModes shouldBe listOf("렌터카")
        input.preferenceProfile.petFriendly shouldBe true
        input.timeWindows.map { it.date } shouldContainExactly listOf(start, start.plusDays(1), end)
        input.fixedBlocks.single().poiId shouldBe poi
    }

    "앵커: 숙박일=거점 좌표, 체크아웃일=전날 거점(prev_stay)" {
        val agent = CapturingAgent(now)
        val anchors = listOf(
            DayAnchorView(start, 37.5, 127.0),               // 08-01
            DayAnchorView(start.plusDays(1), 35.1, 129.0),   // 08-02
        )
        service(agent, fullPrefs, anchors).generate(acc, tripId, GenerationMode.FULLY_AI)
        val a = agent.captured!!.anchors
        a.map { it.date } shouldContainExactly listOf(start, start.plusDays(1), end)
        a.first { it.date == end }.lat shouldBe 35.1 // 체크아웃일 08-03 = 전날(08-02) 거점
    }

    "취향 미설정이면 빈 취향·null budgetLevel" {
        val agent = CapturingAgent(now)
        val empty = PreferenceSnapshot(emptyList(), emptyList(), emptyList(), emptyList(), null, emptyList(), false, null)
        service(agent, empty, emptyList()).generate(acc, tripId, GenerationMode.FULLY_AI)
        agent.captured!!.tripContext.budgetLevel shouldBe null
        agent.captured!!.preferenceProfile.styles shouldBe emptyList()
        agent.captured!!.anchors shouldBe emptyList()
    }

    "ScheduleAgent 실패 시 결정론 최소 폴백(INV-4) — isFallback·MINIMAL·고정블록 보존" {
        val result = service(ThrowingAgent(), fullPrefs, emptyList()).generate(acc, tripId, GenerationMode.FULLY_AI)
        result.isFallback shouldBe true
        result.solveMode shouldBe SolveMode.MINIMAL
        // must_visit 고정 블록(08-01 12:00)은 폴백에도 보존
        val day0 = result.days.first { it.date == start }
        day0.slots.single().let {
            it.sourcePoiId shouldBe poi
            it.isFixed shouldBe true
        }
    }
})
