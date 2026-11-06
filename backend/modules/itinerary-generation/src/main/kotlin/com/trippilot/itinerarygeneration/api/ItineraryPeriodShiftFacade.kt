package com.trippilot.itinerarygeneration.api

import java.util.UUID

/** 여행 기간 이동(TRIP-1789)에 일정을 함께 민다 — 공개 계약(R1). 호출자 트랜잭션에 참여한다. */
interface ItineraryPeriodShiftFacade {
    /** 일정 쓰기 잠금을 잡고 판정 재료를 읽는다. 생성 시작이 트랜잭션 밖에서 옛 기간을 읽는 창은 남는다(세션 중복 잠금은 따로다). */
    fun lockForPeriodChange(accountId: UUID, tripId: UUID): ItineraryPeriodState

    fun shiftDates(tripId: UUID, days: Long)

    /** 일수를 바꾸며 일정을 버린다. 일정이 없으면 아무 일도 없다. 재생성·AI 호출은 없다. */
    fun discard(tripId: UUID)
}

data class ItineraryPeriodState(val hasItinerary: Boolean, val generating: Boolean, val hasVisits: Boolean)
