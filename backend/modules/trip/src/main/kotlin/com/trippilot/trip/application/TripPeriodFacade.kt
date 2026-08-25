package com.trippilot.trip.application

import com.trippilot.trip.api.FixedVisit
import com.trippilot.trip.api.OwnedTripPeriod
import com.trippilot.trip.api.TripFacade
import com.trippilot.trip.api.TripListFacade
import com.trippilot.trip.api.TripSummaryView
import com.trippilot.trip.api.TripGenerationContext
import com.trippilot.trip.api.TripOwnerFacade
import com.trippilot.trip.api.TripPeriod
import com.trippilot.trip.domain.MustVisitRepository
import com.trippilot.trip.domain.TripRepository
import org.springframework.stereotype.Service
import java.util.UUID

/**
 * [TripFacade] 구현 — TripRepository·MustVisitRepository 를 감싸 소유·삭제 스코프를 적용해 api-safe 데이터만 노출.
 * 타 계정·삭제 여행은 null(존재 은닉, TripService.ownedOrNotFound 와 동일 규칙).
 *
 * [TripOwnerFacade] 도 여기서 구현한다 — 같은 리포지토리를 읽고 스코프 규칙만 다르다(사용자 맥락 없는 호출).
 */
@Service
class TripPeriodFacade(
    private val repo: TripRepository,
    private val mustVisits: MustVisitRepository,
) : TripFacade, TripListFacade, TripOwnerFacade {
    /** 기록 목록(U5)이 읽는 여행들. 삭제된 여행은 제외하고 최신순으로 [limit] 건까지. */
    override fun findTripsOf(accountId: UUID, limit: Int): List<TripSummaryView> =
        repo.findByAccount(accountId)
            .filter { it.deletedAt == null }
            .sortedByDescending { it.startDate }
            .take(limit)
            .map { TripSummaryView(it.tripId, it.title, it.startDate, it.endDate, it.destinations.sortedBy { d -> d.seq }.map { d -> d.region }) }

    /**
     * 상한에 걸려 비어 보이는 것과 **정말 아무것도 없는 것**을 가르려고 따로 묻는다.
     * 목록만 주면 화면이 "오류인가 없는 건가"를 알 수 없다(INV-4 결).
     */
    override fun hasAnyTrip(accountId: UUID): Boolean =
        repo.findByAccount(accountId).any { it.deletedAt == null }

    override fun findOwnedPeriod(tripId: UUID): OwnedTripPeriod? {
        val trip = repo.findById(tripId)?.takeIf { it.deletedAt == null } ?: return null
        return OwnedTripPeriod(trip.accountId, trip.startDate, trip.endDate)
    }

    override fun findPeriod(accountId: UUID, tripId: UUID): TripPeriod? {
        val trip = repo.findById(tripId)?.takeIf { it.deletedAt == null && it.accountId == accountId } ?: return null
        return TripPeriod(trip.startDate, trip.endDate)
    }

    override fun findGenerationContext(accountId: UUID, tripId: UUID): TripGenerationContext? {
        val trip = repo.findById(tripId)?.takeIf { it.deletedAt == null && it.accountId == accountId } ?: return null
        val fixed = mustVisits.findByTrip(tripId).map { FixedVisit(it.sourcePoiId, it.fixedDate, it.fixedStart, it.dwellMin) }
        return TripGenerationContext(
            startDate = trip.startDate,
            endDate = trip.endDate,
            destinations = trip.destinations.sortedBy { it.seq }.map { it.region },
            companionType = trip.companionType?.name,
            budgetTotal = trip.budgetTotal,
            fixedVisits = fixed,
        )
    }
}
