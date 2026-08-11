package com.trippilot.savedaccommodation.application

import com.trippilot.savedaccommodation.api.BaseAnchorFacade
import com.trippilot.savedaccommodation.api.DayAnchorView
import com.trippilot.savedaccommodation.domain.BaseAssignmentRepository
import com.trippilot.savedaccommodation.domain.BaseSpan
import com.trippilot.savedaccommodation.domain.CoverageResolver
import com.trippilot.savedaccommodation.domain.SavedStayRepository
import com.trippilot.savedaccommodation.domain.TripBaseDayRepository
import org.springframework.stereotype.Service
import java.time.LocalDate
import java.util.UUID

/**
 * [BaseAnchorFacade] 구현 — [BaseAssignmentService.coverage] 와 **같은 판정**(CoverageResolver)으로 확정된 숙박일만
 * 거점 좌표로 매핑. 소유 검증은 호출측(일정 생성) 책임 — 이 read 는 기간을 받아 좌표만 조립(중복 trip 조회 없음).
 *
 * 사용자 해소(`user_pick`)도 여기서 같이 읽는다(TRIP-190) — 안 읽으면 겹침을 풀어도 그 날 앵커가 비어
 * **해소가 화면에만 반영되고 일정은 그대로**가 된다. 미해결·좌표 없는 거점은 제외(부분 목록).
 */
@Service
class BaseAnchorQueryFacade(
    private val bases: BaseAssignmentRepository,
    private val stays: SavedStayRepository,
    private val baseDays: TripBaseDayRepository,
) : BaseAnchorFacade {
    override fun findStayNightAnchors(tripId: UUID, startDate: LocalDate, endDate: LocalDate): List<DayAnchorView> {
        val spans = bases.findByTrip(tripId).map { BaseSpan(it.savedStayId, it.dateFrom, it.dateTo) }
        val picks = baseDays.findByTrip(tripId).mapNotNull { d -> d.savedStayId?.let { d.dayDate to it } }.toMap()
        return CoverageResolver.resolve(startDate, endDate, spans, picks).mapNotNull { day ->
            val stayId = day.savedStayId ?: return@mapNotNull null // 미해결(GAP/OVERLAP) 제외
            val stay = stays.findById(stayId) ?: return@mapNotNull null
            val lat = stay.lat ?: return@mapNotNull null
            val lng = stay.lng ?: return@mapNotNull null
            DayAnchorView(day.date, lat, lng)
        }
    }
}
