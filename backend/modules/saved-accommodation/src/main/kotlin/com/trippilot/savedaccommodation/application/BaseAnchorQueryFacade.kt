package com.trippilot.savedaccommodation.application

import com.trippilot.savedaccommodation.api.BaseAnchorFacade
import com.trippilot.savedaccommodation.api.DayAnchorView
import com.trippilot.savedaccommodation.domain.BaseAssignmentRepository
import com.trippilot.savedaccommodation.domain.BaseSpan
import com.trippilot.savedaccommodation.domain.CoverageResolver
import com.trippilot.savedaccommodation.domain.SavedStayRepository
import com.trippilot.trip.api.TripFacade
import org.springframework.stereotype.Service
import java.util.UUID

/**
 * [BaseAnchorFacade] 구현 — [BaseAssignmentService.coverage] 와 같은 판정(CoverageResolver)으로
 * AUTO 확정 숙박일만 거점 좌표로 매핑. 여행 소유는 TripFacade(R1), 좌표는 SavedStayRepository.
 * GAP/OVERLAP(미해결)·좌표 없는 거점은 앵커에서 제외 — 부분 목록(일정 생성이 앵커 없는 날을 폴백 처리).
 */
@Service
class BaseAnchorQueryFacade(
    private val bases: BaseAssignmentRepository,
    private val stays: SavedStayRepository,
    private val trips: TripFacade,
) : BaseAnchorFacade {
    override fun findStayNightAnchors(accountId: UUID, tripId: UUID): List<DayAnchorView> {
        val period = trips.findPeriod(accountId, tripId) ?: return emptyList() // 미소유·없음(호출측이 이미 404 판정)
        val spans = bases.findByTrip(tripId).map { BaseSpan(it.savedStayId, it.dateFrom, it.dateTo) }
        return CoverageResolver.resolve(period.startDate, period.endDate, spans).mapNotNull { day ->
            val stayId = day.savedStayId ?: return@mapNotNull null // AUTO 만 확정(GAP/OVERLAP 제외)
            val stay = stays.findById(stayId) ?: return@mapNotNull null
            val lat = stay.lat ?: return@mapNotNull null
            val lng = stay.lng ?: return@mapNotNull null
            DayAnchorView(day.date, lat, lng)
        }
    }
}
