package com.trippilot.trip.domain

import com.trippilot.core.error.ValidationFailed
import io.kotest.assertions.throwables.shouldThrow
import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.shouldBe
import io.kotest.property.Arb
import io.kotest.property.arbitrary.enum
import io.kotest.property.arbitrary.int
import io.kotest.property.checkAll
import java.time.Instant
import java.time.LocalDate
import java.util.UUID

/** 상태전이 단방향(INV-U1-13) · Σnights ≤ 기간(INV-U1-14) PBT. */
class TripPropertyTest : StringSpec({

    val now = Instant.parse("2026-07-26T00:00:00Z")
    val acc = UUID.randomUUID()
    val start = LocalDate.parse("2026-08-01")

    "상태전이는 앞으로만(뒤·제자리 불가)" {
        checkAll(Arb.enum<TripStatus>(), Arb.enum<TripStatus>()) { from, to ->
            from.canTransitionTo(to) shouldBe (to.ordinal > from.ordinal)
        }
    }

    "Σnights ≤ 기간이면 생성 · 초과면 거부(INV-U1-14)" {
        checkAll(Arb.int(0..14), Arb.int(0..6)) { tripNights, extra ->
            val end = start.plusDays(tripNights.toLong())
            val destNights = tripNights + extra // extra=0 → 경계(허용), extra>0 → 초과(거부)
            val dests = listOf(TripDestination(0, "제주", destNights))
            val create = { Trip.create(acc, null, start, end, 1, null, null, emptyMap(), dests, now) }
            if (destNights <= tripNights) {
                create().destinations.single().nights shouldBe destNights
            } else {
                shouldThrow<ValidationFailed> { create() }
            }
        }
    }
})
