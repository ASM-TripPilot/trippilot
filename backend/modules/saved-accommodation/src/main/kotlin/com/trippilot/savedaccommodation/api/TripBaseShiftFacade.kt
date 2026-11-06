package com.trippilot.savedaccommodation.api

import java.time.LocalDate
import java.util.UUID

/** 여행 기간 이동(TRIP-1789)에 거점을 함께 민다 — 공개 계약(R1). 호출자 트랜잭션에 참여한다. */
interface TripBaseShiftFacade {
    fun shiftDates(tripId: UUID, days: Long)

    /** 일수가 바뀌어 일정을 버릴 때 — 새 기간 밖 거점을 자른다. 전부 밖이면 지운다. */
    fun fitToPeriod(tripId: UUID, startDate: LocalDate, endDate: LocalDate)
}
