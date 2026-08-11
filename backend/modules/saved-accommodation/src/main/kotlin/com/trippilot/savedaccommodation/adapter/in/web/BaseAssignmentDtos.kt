package com.trippilot.savedaccommodation.adapter.`in`.web

import com.trippilot.savedaccommodation.application.AssignBaseCommand
import com.trippilot.savedaccommodation.application.TripCoverage
import com.trippilot.savedaccommodation.domain.BaseAssignment
import com.trippilot.savedaccommodation.domain.BaseResolution
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

/** 해소 시트의 선택 — 그 날 거점으로 쓸 숙소. 고를 수 있는 후보는 [DayCoverageDto.candidates]. */
data class ResolveCoverageDayRequest(
    @field:NotNull val savedStayId: UUID?,
)

/** 커버리지 상태 — blocked면 일정 생성 진입 차단(INV-U1-16). */
data class CoverageResponse(
    val blocked: Boolean,
    val days: List<DayCoverageDto>,
) {
    companion object {
        fun from(c: TripCoverage) = CoverageResponse(c.blocked, c.days.map { DayCoverageDto.from(it) })
    }
}

/**
 * 하루 상태. [status] 는 배정이 말하는 판정, [resolution] 은 확정 여부 — **두 축이 다르다**.
 * 겹침을 사용자가 풀면 `status=OVERLAP · resolution=USER_PICK` 이다(겹친 사실 자체는 남는다).
 */
data class DayCoverageDto(
    val date: LocalDate,
    val status: CoverageStatus,
    val savedStayId: UUID?,
    val resolution: BaseResolution?,
    /** 겹침일에 고를 수 있는 숙소. 그 외 날짜는 빈 배열. */
    val candidates: List<UUID>,
) {
    companion object {
        fun from(d: DayCoverage) = DayCoverageDto(d.date, d.status, d.savedStayId, d.resolution, d.candidates)
    }
}
