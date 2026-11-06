package com.trippilot.savedaccommodation.application

import com.trippilot.savedaccommodation.api.TripBaseShiftFacade
import com.trippilot.savedaccommodation.domain.BaseAssignmentRepository
import com.trippilot.savedaccommodation.domain.TripBaseDayRepository
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import java.time.LocalDate
import java.util.UUID

/**
 * 구간 배정·날짜별 확정 거점을 같은 칸수만큼 민다. 숙소 자체의 체크인·아웃(`saved_stay`)은 건드리지 않는다 — 사용자의
 * 예약 사실이고, 커버리지 판정도 배정 구간만 본다(BR-U1-27).
 */
@Service
class TripBaseShiftService(
    private val bases: BaseAssignmentRepository,
    private val baseDays: TripBaseDayRepository,
) : TripBaseShiftFacade {
    @Transactional
    override fun shiftDates(tripId: UUID, days: Long) {
        bases.findByTrip(tripId).forEach { bases.save(it.shiftedBy(days)) }
        baseDays.shiftDates(tripId, days)
    }

    @Transactional
    override fun fitToPeriod(tripId: UUID, startDate: LocalDate, endDate: LocalDate) {
        bases.findByTrip(tripId).forEach { base ->
            val fitted = base.fittedTo(startDate, endDate)
            if (fitted == null) bases.delete(base) else bases.save(fitted)
        }
        baseDays.deleteOutside(tripId, startDate, endDate)
    }
}
