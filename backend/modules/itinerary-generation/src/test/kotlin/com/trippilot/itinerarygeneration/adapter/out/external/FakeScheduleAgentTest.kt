package com.trippilot.itinerarygeneration.adapter.out.external

import com.trippilot.itinerarygeneration.domain.FixedBlock
import com.trippilot.itinerarygeneration.domain.GenerationMode
import com.trippilot.itinerarygeneration.domain.PreferenceProfile
import com.trippilot.itinerarygeneration.domain.RequestMeta
import com.trippilot.itinerarygeneration.domain.ScheduleAgentInput
import com.trippilot.itinerarygeneration.domain.SolveMode
import com.trippilot.itinerarygeneration.domain.TimeWindow
import com.trippilot.itinerarygeneration.domain.TripContext
import com.trippilot.placedata.api.Area
import com.trippilot.placedata.api.CandidatePoolPort
import com.trippilot.placedata.api.GroundedPlace
import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.collections.shouldContain
import io.kotest.matchers.shouldBe
import java.time.Clock
import java.time.Instant
import java.time.LocalDate
import java.time.LocalTime
import java.time.ZoneOffset
import java.util.UUID

/** Fake 에이전트 — 실 ACTIVE 후보(정본) emit(가짜 UUID 아님)·고정 블록 반영·결정론. 동결(272) 가능하게 실 poiId. */
class FakeScheduleAgentTest : StringSpec({

    val clock = Clock.fixed(Instant.parse("2026-08-06T00:00:00Z"), ZoneOffset.UTC)
    val poiA = UUID.randomUUID()
    val poiB = UUID.randomUUID()
    val fixedPoi = UUID.randomUUID()
    val d1 = LocalDate.parse("2026-08-01")

    fun pool(region: String, places: List<GroundedPlace>) = object : CandidatePoolPort {
        override fun resolve(area: Area, categories: Set<String>): List<GroundedPlace> =
            if (area is Area.Region && area.region == region) places else emptyList()
        override fun ground(poiIds: List<UUID>): List<GroundedPlace> = emptyList()
    }

    fun input(destinations: List<String>, fixed: List<FixedBlock>) = ScheduleAgentInput(
        tripId = UUID.randomUUID(),
        generationMode = GenerationMode.FULLY_AI,
        tripContext = TripContext(destinations, d1, d1, "친구", null),
        anchors = emptyList(),
        timeWindows = listOf(TimeWindow(d1, LocalTime.of(9, 0), LocalTime.of(21, 0))),
        fixedBlocks = fixed,
        preferenceProfile = PreferenceProfile(emptyList(), emptyList(), emptyList(), emptyList(), null, emptyList(), false, null),
        recommendationStrength = null,
        requestMeta = RequestMeta("r", clock.instant(), 20_000),
    )

    "실 후보 POI + 고정 블록을 결정론 emit(가짜 UUID 아님)" {
        val places = listOf(
            GroundedPlace(poiA, "성산", 33.4, 126.9, "자연", "제주", null),
            GroundedPlace(poiB, "한라산", 33.3, 126.5, "자연", "제주", null),
        )
        val agent = FakeScheduleAgent(pool("제주", places), clock)
        val inp = input(listOf("제주"), listOf(FixedBlock(fixedPoi, d1, LocalTime.of(12, 0), 90)))

        val out = agent.generate(inp)
        out.solveMode shouldBe SolveMode.DETERMINISTIC
        out.isFallback shouldBe false
        val slots = out.days.single().slots
        slots.any { it.poiId == fixedPoi && it.isFixed } shouldBe true // 고정 블록(HC3)
        slots.map { it.poiId } shouldContain poiA                       // 실 후보(정본)
        // 결정론: 같은 입력 재실행 동일 순서
        agent.generate(inp).days.single().slots.map { it.poiId } shouldBe slots.map { it.poiId }
    }

    "후보 지역에 POI 없으면 고정 블록만" {
        val agent = FakeScheduleAgent(pool("제주", emptyList()), clock)
        val out = agent.generate(input(listOf("부산"), listOf(FixedBlock(fixedPoi, d1, LocalTime.of(12, 0), 90))))
        out.days.single().slots.all { it.isFixed } shouldBe true
    }
})
