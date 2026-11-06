package com.trippilot.itinerarygeneration.domain

import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.shouldBe
import io.kotest.matchers.shouldNotBe
import io.kotest.property.Arb
import io.kotest.property.arbitrary.int
import io.kotest.property.arbitrary.list
import io.kotest.property.arbitrary.long
import io.kotest.property.checkAll
import java.time.Instant
import java.time.LocalDate
import java.time.LocalTime
import java.util.UUID

/** 기간 이동(TRIP-1789) — 임의의 칸수 k 로 밀어도 일차 수·슬롯 수·순서·시각은 그대로이고 모든 날짜 = 원래 + k. */
class ItineraryShiftPropertyTest : StringSpec({

    val now = Instant.parse("2026-08-05T00:00:00Z")
    val start = LocalDate.parse("2026-08-10")

    fun itinerary(slotCounts: List<Int>) = Itinerary.create(
        UUID.randomUUID(), SolveMode.FULL_AI, GenerationMode.FULLY_AI, false,
        slotCounts.mapIndexed { dayIdx, n ->
            ItineraryDay.of(
                start.plusDays(dayIdx.toLong()), dayIdx,
                (0 until n).map {
                    VisitSlot.of(
                        UUID.randomUUID(), UUID.randomUUID(), it, LocalTime.of(9 + it, 0), LocalTime.of(9 + it, 30),
                        isFixed = it == 0, hasViolation = it == 1, distanceRange = "약 1km", placementReason = "이유", violationReason = "사유".takeIf { _ -> it == 1 },
                    )
                },
            )
        },
        now,
    )

    fun Itinerary.content() = days.map { d -> d.dayOrder to d.slots.map { listOf(it.sourcePoiId, it.poiSnapshotId, it.orderIndex, it.startAt, it.endAt, it.isFixed, it.hasViolation, it.distanceRange, it.placementReason, it.violationReason) } }

    "민 뒤 일차·슬롯·순서·값 불변, 날짜만 +k" {
        checkAll(Arb.list(Arb.int(0..6), 1..10), Arb.long(-400L..400L)) { counts, k ->
            val before = itinerary(counts)
            val after = before.shiftedBy(k, now)

            after.content() shouldBe before.content()
            after.days.map { it.date } shouldBe before.days.map { it.date.plusDays(k) }
            after.status shouldBe before.status
            after.itineraryId shouldNotBe before.itineraryId // 옛 날짜로 만든 재계획 안이 물러나는 근거
        }
    }
})
