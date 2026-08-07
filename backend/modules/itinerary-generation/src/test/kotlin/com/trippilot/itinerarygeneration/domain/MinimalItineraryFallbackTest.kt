package com.trippilot.itinerarygeneration.domain

import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.shouldBe
import java.time.Instant
import java.time.LocalDate
import java.time.LocalTime
import java.util.UUID

/**
 * INV-4 결정론 폴백 — must_visit 고정 블록만으로 최소 일정. isFallback=true·MINIMAL·거리 없음(INV-3).
 * 시각 미지정(ANYTIME) 고정 블록도 첫 일자에 결정론적으로 배치한다 — 2단계 생성(TRIP-267)에서 ANYTIME 은
 * 2차만 맡으므로, 폴백이 버리면 must_visit 이 일정에서 통째로 사라져 HC3 가 조용히 깨진다.
 */
class MinimalItineraryFallbackTest : StringSpec({

    val at = Instant.parse("2026-08-06T00:00:00Z")
    val d1 = LocalDate.parse("2026-08-01")
    val d2 = LocalDate.parse("2026-08-02")
    val poiA = UUID.randomUUID()
    val poiB = UUID.randomUUID()

    fun input(fixed: List<FixedBlock>) = ScheduleAgentInput(
        tripId = UUID.randomUUID(),
        generationMode = GenerationMode.FULLY_AI,
        tripContext = TripContext(listOf("제주"), d1, d2, "친구", null),
        anchors = emptyList(),
        timeWindows = listOf(
            TimeWindow(d1, LocalTime.of(9, 0), LocalTime.of(21, 0)),
            TimeWindow(d2, LocalTime.of(9, 0), LocalTime.of(21, 0)),
        ),
        fixedBlocks = fixed,
        preferenceProfile = PreferenceProfile(emptyList(), emptyList(), emptyList(), emptyList(), null, emptyList(), false, null),
        recommendationStrength = null,
        requestMeta = RequestMeta("r", at, 20_000),
    )

    "고정 블록을 날짜별로 배치 + MINIMAL·isFallback·degraded" {
        val out = MinimalItineraryFallback.of(
            input(listOf(FixedBlock(poiA, d1, LocalTime.of(12, 0), 90))),
            at,
        )
        out.isFallback shouldBe true
        out.solveMode shouldBe SolveMode.MINIMAL
        out.freshness.degraded shouldBe true
        val slot = out.days.first { it.date == d1 }.slots.single()
        slot.poiId shouldBe poiA
        slot.startAt shouldBe LocalTime.of(12, 0)
        slot.endAt shouldBe LocalTime.of(13, 30) // dwell 90분
        slot.isFixed shouldBe true
        slot.distanceRange shouldBe null // INV-3: 거리 추정 없음
        out.days.first { it.date == d2 }.slots shouldBe emptyList()
    }

    "시각 미지정(ANYTIME) 고정 블록은 첫 일자에 배치 — 폴백에서도 HC3 유지" {
        val out = MinimalItineraryFallback.of(
            input(listOf(FixedBlock(poiB, null, null, null))),
            at,
        )
        val slot = out.days.first { it.date == d1 }.slots.single()
        slot.poiId shouldBe poiB
        slot.isFixed shouldBe true
        out.days.first { it.date == d2 }.slots shouldBe emptyList()
    }

    "지정 블록과 ANYTIME 이 섞이면 지정 블록 뒤에 붙어 겹치지 않는다" {
        val out = MinimalItineraryFallback.of(
            input(listOf(FixedBlock(poiA, d1, LocalTime.parse("12:00"), 90), FixedBlock(poiB, null, null, null))),
            at,
        )
        val slots = out.days.first { it.date == d1 }.slots
        slots.map { it.poiId } shouldBe listOf(poiA, poiB)
        slots[1].startAt shouldBe slots[0].endAt // 겹침 없음
    }
})
