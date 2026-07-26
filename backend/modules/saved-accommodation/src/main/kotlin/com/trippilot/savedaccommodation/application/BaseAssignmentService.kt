package com.trippilot.savedaccommodation.application

import com.trippilot.core.error.FieldError
import com.trippilot.core.error.ResourceNotFound
import com.trippilot.core.error.ValidationFailed
import com.trippilot.savedaccommodation.domain.BaseAssignment
import com.trippilot.savedaccommodation.domain.BaseAssignmentRepository
import com.trippilot.savedaccommodation.domain.BaseSpan
import com.trippilot.savedaccommodation.domain.CoverageResolver
import com.trippilot.savedaccommodation.domain.DayCoverage
import com.trippilot.savedaccommodation.domain.SavedStayRepository
import com.trippilot.trip.api.TripFacade
import org.springframework.stereotype.Service
import java.time.Clock
import java.time.LocalDate
import java.util.UUID

/** 거점 배정 요청 — 등록 숙소를 [dateFrom, dateTo) 구간 거점으로. */
data class AssignBaseCommand(
    val savedStayId: UUID,
    val dateFrom: LocalDate,
    val dateTo: LocalDate,
)

/** 여행 커버리지 상태 — 숙박일별 판정 + 차단 여부(INV-U1-16 게이트). */
data class TripCoverage(val blocked: Boolean, val days: List<DayCoverage>)

/**
 * 구간 거점 배정 + 커버리지(C4). 여행 소유는 [TripFacade](R1, trip.api)로, 숙소 소유는 SavedStayRepository로 판정.
 * 타 계정·없는 여행/숙소는 404(존재 은닉). trip_base_day 확정 영속화·user_pick 해소·TripBaseResolved 이벤트는
 * 소비자(itinerary-generation, Sprint 3) 도입 시 — 현재는 커버리지 상태를 산출만 한다.
 */
@Service
class BaseAssignmentService(
    private val bases: BaseAssignmentRepository,
    private val stays: SavedStayRepository,
    private val trips: TripFacade,
    private val clock: Clock,
) {
    fun assign(accountId: UUID, tripId: UUID, cmd: AssignBaseCommand): BaseAssignment {
        val period = ownedTripPeriod(accountId, tripId)
        // 거점 숙소도 소유자 것이어야(타 계정 숙소로 거점 불가).
        val stay = stays.findById(cmd.savedStayId)?.takeIf { it.accountId == accountId } ?: throw ResourceNotFound()
        // INV-U1-08: 좌표 미확정 숙소는 거점 배정 불가(일정 생성이 거점 좌표를 요구).
        if (!stay.coordConfirmed) {
            throw ValidationFailed(listOf(FieldError("savedStayId", "좌표가 확정되지 않은 숙소는 거점으로 배정할 수 없습니다(INV-U1-08).")))
        }
        return bases.save(
            BaseAssignment.assign(
                tripId, stay.savedStayId, cmd.dateFrom, cmd.dateTo,
                period.startDate, period.endDate, clock.instant(),
            ),
        )
    }

    fun list(accountId: UUID, tripId: UUID): List<BaseAssignment> {
        ownedTripPeriod(accountId, tripId)
        return bases.findByTrip(tripId)
    }

    fun coverage(accountId: UUID, tripId: UUID): TripCoverage {
        val period = ownedTripPeriod(accountId, tripId)
        val spans = bases.findByTrip(tripId).map { BaseSpan(it.savedStayId, it.dateFrom, it.dateTo) }
        val days = CoverageResolver.resolve(period.startDate, period.endDate, spans)
        return TripCoverage(CoverageResolver.blocked(days), days)
    }

    fun remove(accountId: UUID, tripId: UUID, baseAssignmentId: UUID) {
        ownedTripPeriod(accountId, tripId)
        val base = bases.findById(baseAssignmentId)?.takeIf { it.tripId == tripId } ?: throw ResourceNotFound()
        bases.delete(base)
    }

    /** 여행이 없거나 삭제됐거나 타 계정이면 404(존재 은닉). */
    private fun ownedTripPeriod(accountId: UUID, tripId: UUID) =
        trips.findPeriod(accountId, tripId) ?: throw ResourceNotFound()
}
