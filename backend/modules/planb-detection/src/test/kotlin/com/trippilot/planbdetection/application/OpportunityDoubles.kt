package com.trippilot.planbdetection.application

import com.trippilot.itinerarygeneration.api.ItineraryPlanFacade
import com.trippilot.itinerarygeneration.api.PlannedSlotView
import com.trippilot.planbdetection.domain.OpportunityPort
import com.trippilot.planbdetection.domain.OpportunityQuery
import com.trippilot.planbdetection.domain.OpportunityReply
import com.trippilot.planbdetection.domain.PlanBTrigger
import com.trippilot.planbdetection.domain.TriggerKind
import com.trippilot.planbdetection.domain.TriggerLifecycle
import com.trippilot.planbdetection.domain.TriggerScope
import com.trippilot.planbdetection.domain.TriggerSeverity
import com.trippilot.planbdetection.domain.TriggerState
import com.trippilot.trip.api.TripFacade
import com.trippilot.trip.api.TripPeriod
import org.springframework.beans.factory.ObjectProvider
import java.time.Clock
import java.time.Instant
import java.time.LocalDate
import java.time.LocalTime
import java.time.ZoneOffset
import java.util.UUID

/** 소유자 한 명의 여행 하나 — 남의 계정·다른 여행이면 null(실물처럼 존재를 숨긴다). */
internal class OpportunityTrips(private val owner: UUID, private val tripId: UUID, var period: TripPeriod) : TripFacade {
    override fun findPeriod(accountId: UUID, tripId: UUID): TripPeriod? =
        period.takeIf { accountId == owner && tripId == this.tripId }

    override fun findGenerationContext(accountId: UUID, tripId: UUID) = error("기회 조회는 생성 컨텍스트를 읽지 않습니다.")
}

/** 계획 슬롯 — 몇 번 읽혔는지 센다(꺼짐·범위 밖이면 읽지도 않는다). */
internal class OpportunityPlans(var slots: List<PlannedSlotView> = emptyList()) : ItineraryPlanFacade {
    var reads = 0

    override fun findPlanSlots(accountId: UUID, tripId: UUID): List<PlannedSlotView> {
        reads++
        return slots
    }

    override fun findPlannedPlaces(accountId: UUID, tripId: UUID) = error("기회 조회는 이름 목록을 읽지 않습니다.")
}

/** 받은 질의를 모은다 — 실물처럼 실패는 예외로 말한다([answer] 가 던지면 그대로 던진다). */
internal class RecordingOpportunityPort(
    var answer: (OpportunityQuery) -> OpportunityReply = { OpportunityReply(emptyList(), emptyList()) },
) : OpportunityPort {
    val queries = mutableListOf<OpportunityQuery>()

    override fun find(query: OpportunityQuery): OpportunityReply {
        queries += query
        return answer(query)
    }
}

/** 기회 경계 빈 — null 이면 빈이 없는 것(모드 off)과 같다. */
internal fun opportunityPorts(port: OpportunityPort?): ObjectProvider<OpportunityPort> =
    object : ObjectProvider<OpportunityPort> {
        override fun getObject(): OpportunityPort = port ?: error("OpportunityPort 빈이 없습니다.")
        override fun getIfAvailable(): OpportunityPort? = port
    }

/** 그 여행·그 날의 트리거 행 — 기본은 떠 있는 날짜 전체 날씨 위험이다(종류·심각도·상태를 바꿔 대조군을 만든다). */
internal fun weatherTrigger(
    tripId: UUID,
    date: LocalDate,
    severity: TriggerSeverity = TriggerSeverity.RISK,
    state: TriggerState = TriggerState.ACTIVE,
    kind: TriggerKind = TriggerKind.WEATHER,
    slotKey: String? = null,
): PlanBTrigger = PlanBTrigger.active(
    tripId, UUID.randomUUID(), kind, date, slotKey, mapOf("pop" to 70), TriggerScope.FULL_DAY, "비 예보 70%",
    Instant.parse("2026-10-20T00:15:00Z"), severity,
).copy(state = state)

/** KST 로 그 날 그 시각인 고정 시계. */
internal fun kstClock(date: LocalDate, time: LocalTime): Clock =
    Clock.fixed(date.atTime(time).atZone(TriggerLifecycle.TRAVEL_ZONE).toInstant(), ZoneOffset.UTC)

internal fun utcClock(instant: String): Clock = Clock.fixed(Instant.parse(instant), ZoneOffset.UTC)

/** 계획 슬롯 한 칸 — 좌표는 기본으로 있다(없는 칸은 명시해서 만든다). */
internal fun plannedSlot(
    date: LocalDate,
    order: Int,
    start: LocalTime,
    end: LocalTime,
    poi: UUID = UUID.randomUUID(),
    lat: Double? = 33.4587,
    lng: Double? = 126.9427,
    endsNextDay: Boolean = false,
) = PlannedSlotView(
    slotKey = "$date#$poi", date = date, poiId = poi, orderIndex = order, startAt = start, endAt = end,
    isFixed = false, endsNextDay = endsNextDay, hasViolation = false, lat = lat, lng = lng,
)
