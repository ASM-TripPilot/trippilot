package com.trippilot.trip.domain

import com.trippilot.core.error.ValidationFailed
import io.kotest.assertions.throwables.shouldThrow
import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.shouldBe
import java.time.Instant
import java.time.LocalDate
import java.time.LocalTime
import java.util.UUID

/** 필수 방문지 불변식 — FIXED 날짜·시각(INV-U1-17), dwell 음수 금지. */
class MustVisitTest : StringSpec({

    val now = Instant.parse("2026-07-31T00:00:00Z")
    val trip = UUID.randomUUID()
    val snap = UUID.randomUUID()
    val poi = UUID.randomUUID()

    "ANYTIME은 날짜·시각 없이 추가" {
        val mv = MustVisit.add(trip, snap, poi, MustVisitType.ANYTIME, null, null, 60, now)
        mv.type shouldBe MustVisitType.ANYTIME
        mv.dwellMin shouldBe 60
    }

    "FIXED는 날짜·시각 필수(INV-U1-17)" {
        shouldThrow<ValidationFailed> { MustVisit.add(trip, snap, poi, MustVisitType.FIXED, null, null, null, now) }
        shouldThrow<ValidationFailed> { MustVisit.add(trip, snap, poi, MustVisitType.FIXED, LocalDate.parse("2026-08-01"), null, null, now) }
        // 둘 다 있으면 통과
        MustVisit.add(trip, snap, poi, MustVisitType.FIXED, LocalDate.parse("2026-08-01"), LocalTime.parse("12:00"), null, now).type shouldBe MustVisitType.FIXED
    }

    "체류 시간 음수는 400" {
        shouldThrow<ValidationFailed> { MustVisit.add(trip, snap, poi, MustVisitType.ANYTIME, null, null, -1, now) }
    }
})
