package com.trippilot.savedaccommodation.adapter.`in`.web

import com.trippilot.savedaccommodation.application.AssignBaseCommand
import com.trippilot.savedaccommodation.application.TripCoverage
import com.trippilot.savedaccommodation.domain.BaseAssignment
import com.trippilot.savedaccommodation.domain.CoverageStatus
import com.trippilot.savedaccommodation.domain.DayCoverage
import jakarta.validation.constraints.NotNull
import java.time.LocalDate
import java.util.UUID

/** 거점 배정 요청 — 등록 숙소를 [dateFrom, dateTo) 구간 거점으로. 구간 검증은 도메인. */
data class AssignBaseRequest(
    @field:NotNull val savedStayId: UUID?,
    @field:NotNull val dateFrom: LocalDate?,
    @field:NotNull val dateTo: LocalDate?,
) {
    fun toCommand() = AssignBaseCommand(savedStayId = savedStayId!!, dateFrom = dateFrom!!, dateTo = dateTo!!)
}

data class BaseAssignmentResponse(
    val baseAssignmentId: UUID,
    val savedStayId: UUID,
    val dateFrom: LocalDate,
    val dateTo: LocalDate,
) {
    companion object {
        fun from(b: BaseAssignment) = BaseAssignmentResponse(b.baseAssignmentId, b.savedStayId, b.dateFrom, b.dateTo)
    }
}

/** 커버리지 상태 — blocked면 일정 생성 진입 차단(INV-U1-16). */
data class CoverageResponse(
    val blocked: Boolean,
    val days: List<DayCoverageDto>,
) {
    companion object {
        fun from(c: TripCoverage) = CoverageResponse(c.blocked, c.days.map { DayCoverageDto.from(it) })
    }
}

data class DayCoverageDto(
    val date: LocalDate,
    val status: CoverageStatus,
    val savedStayId: UUID?,
) {
    companion object {
        fun from(d: DayCoverage) = DayCoverageDto(d.date, d.status, d.savedStayId)
    }
}
