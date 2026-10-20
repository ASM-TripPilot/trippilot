package com.trippilot.planbdetection.application

import com.trippilot.itinerarygeneration.api.PlannedSlotView
import com.trippilot.trip.api.TripDestinationRef
import com.trippilot.trip.api.TripFacade
import com.trippilot.trip.api.TripGenerationContext
import com.trippilot.trip.api.TripPeriod
import com.trippilot.weathercontext.api.ActiveWarning
import com.trippilot.weathercontext.api.AirGrade
import com.trippilot.weathercontext.api.AirRegion
import com.trippilot.weathercontext.api.AlertRead
import com.trippilot.weathercontext.api.WeatherAlertFacade
import java.time.Instant
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.LocalTime
import java.time.ZoneId
import java.util.Collections
import java.util.UUID

/**
 * 특보·대기질 감지기 테스트의 대역. 퍼사드는 실물처럼 **실패를 값(`AlertRead.Unknown`)으로** 말한다 — 실물(`WeatherAlertService`)이
 * 포트 예외를 그렇게 접는다(대역이 실물보다 관대하면 거짓 초록 — anti-patterns).
 */
internal class FakeAlerts : WeatherAlertFacade {
    @Volatile var live = true
    @Volatile var warnings: AlertRead<List<ActiveWarning>> = AlertRead.Ok(emptyList())
    val airByDate = HashMap<LocalDate, AlertRead<Map<AirRegion, AirGrade>>>()
    val warningCalls: MutableList<Instant> = Collections.synchronizedList(mutableListOf())
    val airCalls: MutableList<LocalDate> = Collections.synchronizedList(mutableListOf())

    override fun isLive() = live

    override fun warnings(at: Instant): AlertRead<List<ActiveWarning>> {
        warningCalls += at
        return warnings
    }

    override fun airGrades(date: LocalDate, at: Instant): AlertRead<Map<AirRegion, AirGrade>> {
        airCalls += date
        return airByDate[date] ?: AlertRead.Unknown("no-forecast")
    }
}

/** 여행 목적지 대역 — 정해 둔 여행만 답하고, 나머지는 실물처럼 null(없음·타 계정)이다. */
internal class FakeTripDestinations : TripFacade {
    val contexts = HashMap<UUID, TripGenerationContext>()

    fun put(tripId: UUID, start: LocalDate, end: LocalDate, vararg destinations: TripDestinationRef) = apply {
        contexts[tripId] = TripGenerationContext(start, end, destinations.toList(), null, null, emptyList())
    }

    override fun findPeriod(accountId: UUID, tripId: UUID): TripPeriod? = contexts[tripId]?.let { TripPeriod(it.startDate, it.endDate) }

    override fun findGenerationContext(accountId: UUID, tripId: UUID): TripGenerationContext? = contexts[tripId]
}

internal object AlertFixtures {
    val ZONE: ZoneId = ZoneId.of("Asia/Seoul")
    fun kst(local: String): Instant = LocalDateTime.parse(local).atZone(ZONE).toInstant()

    /** 2026-10-20(화) — 오늘. */
    val DAY: LocalDate = LocalDate.parse("2026-10-20")

    val ROUND: Instant = kst("2026-10-20T13:15")
    val NOW: Instant = kst("2026-10-20T13:20")
    val NEXT_ROUND: Instant = kst("2026-10-20T14:15")

    val POHANG = TripDestinationRef("포항시", "47110", 2)
    val JEJU = TripDestinationRef("제주", "50", 2)

    fun slot(name: String?, category: String?, start: String, end: String, date: LocalDate = DAY): PlannedSlotView {
        val poi = UUID.randomUUID()
        return PlannedSlotView(
            slotKey = "$date#$poi", date = date, poiId = poi, orderIndex = 0,
            startAt = LocalTime.parse(start), endAt = LocalTime.parse(end),
            isFixed = false, endsNextDay = false, hasViolation = false,
            nameKo = name, category = category, lat = 36.0, lng = 129.5,
        )
    }

    fun target(
        tripId: UUID,
        vararg slots: PlannedSlotView,
        date: LocalDate = DAY,
        phase: SweepPhase = SweepPhase.DAYTIME,
        now: Instant = NOW,
        round: Instant = ROUND,
    ) = SweepTarget(tripId, UUID.randomUUID(), date, phase, round, now, slots.toList(), emptyList())
}
