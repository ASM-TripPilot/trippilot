package com.trippilot.savedaccommodation.domain

import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.shouldBe
import io.kotest.property.Arb
import io.kotest.property.arbitrary.int
import io.kotest.property.checkAll
import java.time.Instant
import java.time.LocalDate
import java.util.UUID

/** 거점 배정 — 기간 이동(TRIP-1789)의 밀기·자르기 불변식. */
class BaseAssignmentShiftPropertyTest : StringSpec({

    val base = LocalDate.parse("2026-08-10")
    val now = Instant.parse("2026-07-01T00:00:00Z")

    fun assignment(from: LocalDate, to: LocalDate) =
        BaseAssignment.reconstitute(UUID.randomUUID(), UUID.randomUUID(), UUID.randomUUID(), from, to, now)

    "민 구간은 양 끝이 +k 다" {
        checkAll(Arb.int(0..30), Arb.int(1..15), Arb.int(-400..400)) { offset, nights, k ->
            val from = base.plusDays(offset.toLong())
            val moved = assignment(from, from.plusDays(nights.toLong())).shiftedBy(k.toLong())
            moved.dateFrom shouldBe from.plusDays(k.toLong())
            moved.dateTo shouldBe from.plusDays(nights.toLong() + k)
        }
    }

    "자른 구간은 새 기간 안이고 dateTo > dateFrom 이거나(INV-U1-15) 없다 — 겹치는 박이 있으면 남는다" {
        checkAll(Arb.int(0..30), Arb.int(1..15), Arb.int(0..30), Arb.int(0..15)) { offset, nights, startOffset, tripNights ->
            val from = base.plusDays(offset.toLong())
            val to = from.plusDays(nights.toLong())
            val start = base.plusDays(startOffset.toLong())
            val end = start.plusDays(tripNights.toLong())

            val fitted = assignment(from, to).fittedTo(start, end)

            if (fitted != null) {
                (fitted.dateFrom >= start && fitted.dateTo <= end && fitted.dateTo > fitted.dateFrom) shouldBe true
            } else {
                (minOf(to, end) > maxOf(from, start)) shouldBe false
            }
        }
    }
})
