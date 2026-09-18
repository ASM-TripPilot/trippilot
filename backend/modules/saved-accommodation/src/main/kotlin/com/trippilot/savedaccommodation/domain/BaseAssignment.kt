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
            // 여행 기간 밖은 **거부한다**(INV-U1-15) — 서버가 기간을 늘려 주지 않는다. 기간이 바뀌면 일정·커버리지·
            // 필수 방문지가 모두 영향을 받으므로, 늘릴지는 사용자가 여행 편집에서 정한다(US-TRIP-03 예외 = 클라 2단계).
            //
            // 그래서 **어느 쪽이 왜 벗어났는지**를 메시지에 담는다. "여행 기간 내여야 합니다"만으로는 화면이
            // "8/5까지 잡으셨는데 여행은 8/3까지예요. 늘릴까요?"를 그릴 수 없다. 지목하는 필드도 나눈다 —
            // 종료일이 문제인데 시작일 칸에 오류를 띄우면 사용자가 엉뚱한 값을 고친다.
            if (dateFrom.isBefore(tripStart)) {
                errors += FieldError("dateFrom", "여행 시작일($tripStart)보다 앞설 수 없습니다. 여행 기간을 먼저 수정해 주세요.")
            }
            if (dateTo.isAfter(tripEnd)) {
                errors += FieldError("dateTo", "여행 종료일($tripEnd)보다 뒤일 수 없습니다. 여행 기간을 먼저 수정해 주세요.")
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
