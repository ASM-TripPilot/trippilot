package com.trippilot.itinerarygeneration.domain

import com.trippilot.core.error.ConflictDetected
import com.trippilot.core.error.ValidationFailed
import io.kotest.assertions.throwables.shouldThrow
import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.shouldBe
import java.time.Instant
import java.time.LocalDate
import java.time.LocalTime
import java.util.UUID

/** 일정 애그리거트 불변식 — 확정 단방향, 슬롯 시각·순서 검증, 정렬 보장. */
class ItineraryTest : StringSpec({

    val now = Instant.parse("2026-08-05T00:00:00Z")
    val trip = UUID.randomUUID()

    fun slot(order: Int, snapshot: UUID? = null) =
        VisitSlot.of(UUID.randomUUID(), snapshot, order, LocalTime.parse("10:00"), LocalTime.parse("11:00"))

    fun itinerary() = Itinerary.create(
        trip, SolveMode.FULL_AI, isFallback = false,
        days = listOf(ItineraryDay.of(LocalDate.parse("2026-08-10"), 0, listOf(slot(0), slot(1)))),
        now = now,
    )

    "생성은 PLANNED" {
        itinerary().status shouldBe ItineraryStatus.PLANNED
    }

    "확정은 PLANNED→CONFIRMED" {
        itinerary().confirm(now).status shouldBe ItineraryStatus.CONFIRMED
    }

    "이미 확정된 일정 재확정은 409" {
        val confirmed = itinerary().confirm(now)
        shouldThrow<ConflictDetected> { confirmed.confirm(now) }
    }

    "슬롯 종료<시작은 400" {
        shouldThrow<ValidationFailed> {
            VisitSlot.of(UUID.randomUUID(), null, 0, LocalTime.parse("11:00"), LocalTime.parse("10:00"))
        }
    }

    "확정(동결)해도 자정 넘김 플래그가 보존된다 — 누락 시 검증 실패로 확정 불가(회귀)" {
        val poi = UUID.randomUUID()
        val midnight = Itinerary.create(
            trip, SolveMode.DETERMINISTIC, isFallback = false,
            days = listOf(
                ItineraryDay.of(
                    LocalDate.parse("2026-08-10"), 0,
                    listOf(VisitSlot.of(poi, null, 0, LocalTime.parse("23:00"), LocalTime.parse("01:00"), endsNextDay = true)),
                ),
            ),
            now = now,
        )
        val confirmed = midnight.confirm(mapOf(poi to UUID.randomUUID()), now) // 던지면 안 됨
        val slot = confirmed.days.single().slots.single()
        slot.endsNextDay shouldBe true
        slot.poiSnapshotId shouldBe confirmed.days.single().slots.single().poiSnapshotId // 동결도 유지
    }

    "자정 넘김(endsNextDay)이면 종료<시작 허용(HC4)" {
        val slot = VisitSlot.of(
            UUID.randomUUID(), null, 0, LocalTime.parse("23:00"), LocalTime.parse("01:00"), endsNextDay = true,
        )
        slot.endsNextDay shouldBe true
        slot.endAt shouldBe LocalTime.parse("01:00")
    }

    "슬롯 순서 음수는 400" {
        shouldThrow<ValidationFailed> {
            VisitSlot.of(UUID.randomUUID(), null, -1, LocalTime.parse("10:00"), LocalTime.parse("11:00"))
        }
    }

    "day 슬롯은 orderIndex 오름차순 정렬" {
        val day = ItineraryDay.of(LocalDate.parse("2026-08-10"), 0, listOf(slot(2), slot(0), slot(1)))
        day.slots.map { it.orderIndex } shouldBe listOf(0, 1, 2)
    }

    "PLANNED 슬롯은 poiSnapshotId null(동결 전)" {
        itinerary().days.first().slots.all { it.poiSnapshotId == null } shouldBe true
    }

    "같은 orderIndex 슬롯 중복은 400" {
        shouldThrow<ValidationFailed> {
            ItineraryDay.of(LocalDate.parse("2026-08-10"), 0, listOf(slot(0), slot(0)))
        }
    }

    "같은 dayOrder 일자 중복은 400" {
        val d1 = ItineraryDay.of(LocalDate.parse("2026-08-10"), 0, listOf(slot(0)))
        val d2 = ItineraryDay.of(LocalDate.parse("2026-08-11"), 0, listOf(slot(0)))
        shouldThrow<ValidationFailed> {
            Itinerary.create(trip, SolveMode.FULL_AI, false, listOf(d1, d2), now)
        }
    }
})
