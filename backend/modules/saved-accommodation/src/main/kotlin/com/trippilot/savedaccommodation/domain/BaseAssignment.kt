package com.trippilot.savedaccommodation.domain

import com.trippilot.core.error.FieldError
import com.trippilot.core.error.ValidationFailed
import java.time.Instant
import java.time.LocalDate
import java.util.UUID

/**
 * 구간 거점 배정(C4). 한 여행의 [dateFrom, dateTo) 구간에 등록 숙소 하나를 거점으로 지정.
 * 불변식 INV-U1-15: dateTo > dateFrom(다박=단일 배정) · 구간은 여행 기간 내.
 * 겹침·공백 판정은 CoverageResolver 소관(여기선 개별 배정만 검증).
 */
class BaseAssignment private constructor(
    val baseAssignmentId: UUID,
    val tripId: UUID,
    val savedStayId: UUID,
    val dateFrom: LocalDate,
    val dateTo: LocalDate,
    val createdAt: Instant,
) {
    companion object {
        fun assign(
            tripId: UUID,
            savedStayId: UUID,
            dateFrom: LocalDate,
            dateTo: LocalDate,
            tripStart: LocalDate,
            tripEnd: LocalDate,
            now: Instant,
        ): BaseAssignment {
            val errors = mutableListOf<FieldError>()
            if (!dateTo.isAfter(dateFrom)) errors += FieldError("dateTo", "거점 종료일은 시작일보다 뒤여야 합니다.") // INV-U1-15
            if (dateFrom.isBefore(tripStart) || dateTo.isAfter(tripEnd)) {
                errors += FieldError("dateFrom", "거점 구간은 여행 기간 내여야 합니다.")
            }
            if (errors.isNotEmpty()) throw ValidationFailed(errors)
            return BaseAssignment(UUID.randomUUID(), tripId, savedStayId, dateFrom, dateTo, now)
        }

        fun reconstitute(
            baseAssignmentId: UUID, tripId: UUID, savedStayId: UUID,
            dateFrom: LocalDate, dateTo: LocalDate, createdAt: Instant,
        ): BaseAssignment = BaseAssignment(baseAssignmentId, tripId, savedStayId, dateFrom, dateTo, createdAt)
    }
}
