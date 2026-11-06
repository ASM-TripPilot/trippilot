package com.trippilot.itinerarygeneration.application

import com.trippilot.itinerarygeneration.api.ItineraryPeriodShiftFacade
import com.trippilot.itinerarygeneration.api.ItineraryPeriodState
import com.trippilot.itinerarygeneration.application.Revalidation.Companion.violations
import com.trippilot.itinerarygeneration.domain.DaySchedule
import com.trippilot.itinerarygeneration.domain.FreshnessMeta
import com.trippilot.itinerarygeneration.domain.GenerationSessionRepository
import com.trippilot.itinerarygeneration.domain.GenerationState
import com.trippilot.itinerarygeneration.domain.Itinerary
import com.trippilot.itinerarygeneration.domain.ItineraryDay
import com.trippilot.itinerarygeneration.domain.ItineraryRepository
import com.trippilot.itinerarygeneration.domain.RevisionActor
import com.trippilot.itinerarygeneration.domain.RevisionKind
import com.trippilot.itinerarygeneration.domain.ScheduleAgentOutput
import com.trippilot.itinerarygeneration.domain.ScheduleAgentPort
import com.trippilot.itinerarygeneration.domain.VisitRecordPort
import com.trippilot.itinerarygeneration.domain.VisitSlot
import com.trippilot.itinerarygeneration.domain.VisitSlotDisplay
import com.trippilot.trip.api.TripOwnerFacade
import org.springframework.stereotype.Service
import org.springframework.transaction.PlatformTransactionManager
import org.springframework.transaction.annotation.Transactional
import org.springframework.transaction.support.TransactionTemplate
import java.time.Clock
import java.util.UUID

/**
 * 여행 기간 이동의 일정 쪽(TRIP-1789 · 사용자 결정 2026-11-04 "일정째 날짜만 이동").
 *
 * 리비전은 쌓지 않는다 — 사용자가 고를 내용이 달라지지 않았다. 옛 스냅숏은 되돌릴 때 새 기간에 맞춘다([ItineraryRevisionService]).
 */
@Service
class ItineraryPeriodShiftService(
    private val itineraries: ItineraryRepository,
    private val sessions: GenerationSessionRepository,
    private val visits: VisitRecordPort,
    private val owners: TripOwnerFacade,
    private val scheduleAgent: ScheduleAgentPort,
    private val repairContexts: RepairContexts,
    private val revisions: ItineraryRevisionService,
    transactionManager: PlatformTransactionManager,
    private val clock: Clock,
) : ItineraryPeriodShiftFacade {
    private val tx = TransactionTemplate(transactionManager)

    @Transactional
    override fun lockForPeriodChange(accountId: UUID, tripId: UUID): ItineraryPeriodState {
        val current = itineraries.lockForTrip(tripId)
        return ItineraryPeriodState(
            hasItinerary = current != null,
            // 2차 생성은 옛 날짜로 나머지 일자를 이어붙인다. 다시 만들기 중에는 일정 상태가 옛 COMPLETE 라 세션도 본다.
            generating = current?.generationState == GenerationState.PARTIAL || tripId in sessions.findRunningTripIds(accountId, listOf(tripId)),
            hasVisits = current != null && visits.hasAny(tripId),
        )
    }

    @Transactional
    override fun shiftDates(tripId: UUID, days: Long) {
        val current = itineraries.lockForTrip(tripId) ?: return
        itineraries.replaceForTrip(tripId, current.shiftedBy(days, clock.instant()))
    }

    /**
     * 버린 일정도 되돌리기 목록에 남긴다 — 되돌리기 지점 없이 일정이 사라지면 안 된다(INV-U3-08). 변경 이력(BR-U4-30)은 여행 중 편집의
     * 축이고 여기는 시작 전만 오므로 남기지 않는다. 지운 뒤에 쓴다 — 삭제의 bulk clear 가 먼저 쓴 이력을 버린다.
     */
    @Transactional
    override fun discard(tripId: UUID) {
        val current = itineraries.lockForTrip(tripId) ?: return
        itineraries.deleteForTrip(tripId)
        revisions.record(current, RevisionActor.USER, RevisionKind.EDIT, DISCARD_SUMMARY)
    }

    /**
     * 요일이 바뀌었으니 위반 표시(휴무 등)를 새 날짜로 다시 잰다. 영업시간 해석은 AI 한 곳이라 재검증을 불러야 하는데(≈20초),
     * 그걸 PATCH 안에서 기다리면 DB 잠금을 문 채 사용자를 세운다 — 그래서 사건을 받아 뒤에서 한다.
     *
     * 멱등이다(at-least-once): 같은 내용이면 쓰지 않는다. 못 물어봤으면(보류) 직전 표시를 잇는다 — 깨끗해졌다고 말하지 않는다.
     * 그 사이 일정이 바뀌었으면 쓰지 않는다 — 판정한 내용과 다르고, 그 쓰기가 자기 재검증을 이미 했다.
     */
    fun revalidate(tripId: UUID) {
        val accountId = owners.findOwnedPeriod(tripId)?.accountId ?: return
        val judged = itineraries.findByTrip(tripId).firstOrNull() ?: return
        if (judged.generationState == GenerationState.PARTIAL) return
        val verdict = Revalidation.attempt(scheduleAgent, judged.toOutput(), tripId, repairContexts.forRevalidation(accountId, tripId))
        if (verdict is Revalidation.Withheld) return
        tx.executeWithoutResult {
            val current = itineraries.lockForTrip(tripId) ?: return@executeWithoutResult
            if (current.itineraryId != judged.itineraryId || !ItineraryContent.sameAs(current, judged)) return@executeWithoutResult
            ViolationText.warnUnattached(verdict.violations(), current.days, tripId)
            val flagged = current.flaggedBy(verdict)
            if (!ItineraryContent.sameAs(current, flagged)) itineraries.replaceForTrip(tripId, flagged)
        }
    }

    private fun Itinerary.flaggedBy(verdict: Revalidation): Itinerary {
        val violations = verdict.violations()
        val flagged = days.mapIndexed { dayIdx, d ->
            ItineraryDay.of(
                d.date, d.dayOrder,
                d.slots.mapIndexed { slotIdx, s ->
                    val hit = violations.filter { it.dayIndex == dayIdx && it.slotIndex == slotIdx }
                    VisitSlot.of(
                        s.sourcePoiId, s.poiSnapshotId, s.orderIndex, s.startAt, s.endAt, s.isFixed, hit.isNotEmpty(), s.endsNextDay,
                        s.distanceRange, s.placementReason, ViolationText.reasonOf(hit), s.alternatives,
                    )
                },
            )
        }
        return Itinerary.reconstitute(
            itineraryId, tripId, status, solveMode, generationMode, isFallback, generationState, flagged,
            createdAt, clock.instant(), candidatesSummary, unplacedMustVisits, scoring,
        )
    }

    private fun Itinerary.toOutput() = ScheduleAgentOutput(
        days = days.map { d -> DaySchedule(d.date, d.slots.map { VisitSlotDisplay(it.sourcePoiId, it.startAt, it.endAt, it.endsNextDay, null, it.isFixed) }) },
        day1ReadyAt = null,
        explanations = emptyMap(),
        solveMode = solveMode,
        isFallback = isFallback,
        freshness = FreshnessMeta(clock.instant(), degraded = false),
    )

    private companion object {
        const val DISCARD_SUMMARY = "기간을 바꾸며 버린 일정"
    }
}
