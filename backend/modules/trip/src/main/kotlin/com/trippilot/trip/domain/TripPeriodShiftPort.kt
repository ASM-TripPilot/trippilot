package com.trippilot.trip.domain

import java.time.LocalDate
import java.util.UUID

/**
 * 기간 이동(TRIP-1789)에 필요한 **여행 밖의 일** — 일정(C8)과 거점(C4)은 여행을 의존하므로 [TripAggregatePort] 와 같은 이유로
 * 모양만 선언하고 `app` 이 잇는다. 이벤트로 넘기지 않는 이유: 409 판정과 날짜 이동이 편집과 같은 트랜잭션이어야 한다
 * (거절이면 아무 날짜도 안 바뀌고, 비동기면 그 사이 일정이 옛 날짜에 남는다).
 */
interface TripPeriodShiftPort {
    /** 일정 쓰기 잠금을 잡고 판정 재료를 읽는다 — 호출자 트랜잭션이 끝날 때까지 일정 쓰기가 기다린다. */
    fun lockPlan(accountId: UUID, tripId: UUID): TripPlanState

    /** 일정 일차·거점 배정을 [days] 칸 민다. 장소·순서·시각은 그대로. */
    fun shiftDates(tripId: UUID, days: Long)

    /** 일정을 버리고 거점 배정을 새 기간에 맞춰 자른다. 재생성·AI 호출은 없다. */
    fun discardPlan(tripId: UUID, startDate: LocalDate, endDate: LocalDate)
}

data class TripPlanState(val hasItinerary: Boolean, val generating: Boolean, val hasVisits: Boolean)
