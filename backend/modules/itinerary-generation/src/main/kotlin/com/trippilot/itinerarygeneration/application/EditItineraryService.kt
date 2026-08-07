package com.trippilot.itinerarygeneration.application

import com.trippilot.core.error.ConflictDetected
import com.trippilot.core.error.ResourceNotFound
import com.trippilot.itinerarygeneration.domain.DaySchedule
import com.trippilot.itinerarygeneration.domain.FreshnessMeta
import com.trippilot.itinerarygeneration.domain.Itinerary
import com.trippilot.itinerarygeneration.domain.ItineraryDay
import com.trippilot.itinerarygeneration.domain.ItineraryRepository
import com.trippilot.itinerarygeneration.domain.ItineraryStatus
import com.trippilot.itinerarygeneration.domain.ScheduleAgentOutput
import com.trippilot.itinerarygeneration.domain.ScheduleAgentPort
import com.trippilot.itinerarygeneration.domain.SolveMode
import com.trippilot.itinerarygeneration.domain.Violation
import com.trippilot.itinerarygeneration.domain.VisitSlot
import com.trippilot.itinerarygeneration.domain.VisitSlotDisplay
import com.trippilot.trip.api.TripFacade
import org.springframework.stereotype.Service
import org.springframework.transaction.PlatformTransactionManager
import org.springframework.transaction.support.TransactionTemplate
import java.time.Clock
import java.time.Instant
import java.time.LocalDate
import java.time.LocalTime
import java.util.UUID

/** 편집 요청 — 전체 교체(사용자가 수정한 일자·슬롯 배열). 슬롯 순서 = 배열 순서. */
data class EditItinerary(val days: List<EditDay>)
data class EditDay(val date: LocalDate, val slots: List<EditSlot>)
data class EditSlot(
    val poiId: UUID,
    val startAt: LocalTime,
    val endAt: LocalTime,
    val isFixed: Boolean,
    val endsNextDay: Boolean, // 자정 넘김(HC4) — 전체 교체 편집이라 클라가 현행 값을 그대로 실어야 소실되지 않는다
)

/**
 * 일정 편집 + 재검증(C8 · US-SCHED-06·07). 편집은 **비차단** — solver.validate(HC1-4)로 위반을 찾아
 * has_violation 으로 표시하되 저장은 허용한다(변경 차단 아님, ADR-0011). PLANNED만 편집 가능(CONFIRMED는 409).
 * 위반 **내용**(type/detail) 실판정은 실 AI(TRIP-229); 현재 Fake validate 는 빈 목록 → 위반 없음으로 흐름 검증.
 */
@Service
class EditItineraryService(
    private val trips: TripFacade,
    private val itineraries: ItineraryRepository,
    private val scheduleAgent: ScheduleAgentPort,
    transactionManager: PlatformTransactionManager,
    private val clock: Clock,
) {
    private val tx = TransactionTemplate(transactionManager)

    fun edit(accountId: UUID, tripId: UUID, edit: EditItinerary): Itinerary {
        trips.findPeriod(accountId, tripId) ?: throw ResourceNotFound() // 소유·존재(404 은닉)
        val current = itineraries.findByTrip(tripId).firstOrNull() ?: throw ResourceNotFound("생성된 일정이 없습니다.")
        if (current.status != ItineraryStatus.PLANNED) throw ConflictDetected(message = "확정된 일정은 수정할 수 없습니다.")

        // 재검증(비차단) — 외부(ScheduleAgent) 호출은 트랜잭션 밖(DB 커넥션 안 물게, generate 와 동일). Fake 는 빈 목록.
        val violations = scheduleAgent.validate(edit.toOutput(current.solveMode, current.isFallback, clock.instant()))
        val flagged = reshape(current, edit, violations)
        return tx.execute { itineraries.replaceForTrip(tripId, flagged) }!!
    }

    /** 편집안 + 위반 → 새 일정 슬롯 배열(위반 슬롯 has_violation=true). identity·createdAt·solveMode 는 현행 보존. */
    private fun reshape(current: Itinerary, edit: EditItinerary, violations: List<Violation>): Itinerary {
        val days = edit.days.mapIndexed { dayIdx, d ->
            ItineraryDay.of(
                d.date, dayIdx,
                d.slots.mapIndexed { slotIdx, s ->
                    val violated = violations.any { it.dayIndex == dayIdx && it.slotIndex == slotIdx }
                    VisitSlot.of(
                        s.poiId, null, slotIdx, s.startAt, s.endAt, s.isFixed,
                        hasViolation = violated, endsNextDay = s.endsNextDay,
                    )
                },
            )
        }
        return Itinerary.reconstitute(
            current.itineraryId, current.tripId, ItineraryStatus.PLANNED, current.solveMode, current.isFallback,
            days, current.createdAt, clock.instant(),
        )
    }
}

/** 편집안 → 재검증 입력(ScheduleAgentOutput). 시각·순서·고정은 슬롯 그대로. 거리/소요시간 없음(INV-3). */
private fun EditItinerary.toOutput(solveMode: SolveMode, isFallback: Boolean, at: Instant): ScheduleAgentOutput =
    ScheduleAgentOutput(
        days = days.map { d ->
            DaySchedule(
                d.date,
                d.slots.map { VisitSlotDisplay(it.poiId, it.startAt, it.endAt, it.endsNextDay, distanceRange = null, isFixed = it.isFixed) },
            )
        },
        day1ReadyAt = null,
        explanations = emptyMap(),
        solveMode = solveMode,
        isFallback = isFallback,
        freshness = FreshnessMeta(at, degraded = false),
    )
