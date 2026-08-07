package com.trippilot.savedaccommodation.application

import com.trippilot.savedaccommodation.api.BaseAnchorFacade
import com.trippilot.savedaccommodation.api.DayAnchorView
import com.trippilot.savedaccommodation.domain.BaseAssignmentRepository
import com.trippilot.savedaccommodation.domain.BaseSpan
import com.trippilot.savedaccommodation.domain.CoverageResolver
import com.trippilot.savedaccommodation.domain.SavedStayRepository
import org.springframework.stereotype.Service
import java.time.LocalDate
import java.util.UUID

/**
 * [BaseAnchorFacade] 구현 — [BaseAssignmentService.coverage] 와 같은 판정(CoverageResolver)으로 AUTO 확정 숙박일만
 * 거점 좌표로 매핑. 소유 검증은 호출측(일정 생성) 책임 — 이 read 는 기간을 받아 좌표만 조립(중복 trip 조회 없음).
 * GAP/OVERLAP(미해결)·좌표 없는 거점은 제외(부분 목록).
 */
@Service
class BaseAnchorQueryFacade(
    private val bases: BaseAssignmentRepository,
    private val stays: SavedStayRepository,
) : BaseAnchorFacade {
    override fun findStayNightAnchors(tripId: UUID, startDate: LocalDate, endDate: LocalDate): List<DayAnchorView> {
        val spans = bases.findByTrip(tripId).map { BaseSpan(it.savedStayId, it.dateFrom, it.dateTo) }
        return CoverageResolver.resolve(startDate, endDate, spans).mapNotNull { day ->
            val stayId = day.savedStayId ?: return@mapNotNull null // AUTO 만 확정(GAP/OVERLAP 제외)
            val stay = stays.findById(stayId) ?: return@mapNotNull null
            val lat = stay.lat ?: return@mapNotNull null
            val lng = stay.lng ?: return@mapNotNull null
            DayAnchorView(day.date, lat, lng)
        }
    }
}
