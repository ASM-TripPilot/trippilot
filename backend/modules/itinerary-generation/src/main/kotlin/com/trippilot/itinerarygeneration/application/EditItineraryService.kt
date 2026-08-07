package com.trippilot.itinerarygeneration.application

import com.trippilot.changelog.api.AppendChangeLog
import com.trippilot.changelog.api.ChangeLogFacade
import com.trippilot.changelog.api.ChangeSourceType
import com.trippilot.changelog.api.DaySnapshotView
import com.trippilot.changelog.api.ItinerarySnapshotView
import com.trippilot.changelog.api.SlotSnapshotView
import com.trippilot.core.error.ConflictDetected
import com.trippilot.core.error.ResourceNotFound
import com.trippilot.itinerarygeneration.domain.DaySchedule
import com.trippilot.itinerarygeneration.domain.FreshnessMeta
import com.trippilot.itinerarygeneration.domain.GenerationState
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

/** 편집 요청 — 전체 교체(사용자가 수정한 일자·슬롯 배열). 슬롯 순서 = 배열 순서. [reason] 은 선택(변경 이력에 남는다). */
data class EditItinerary(val days: List<EditDay>, val reason: String? = null)
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
    private val changeLog: ChangeLogFacade,
    transactionManager: PlatformTransactionManager,
    private val clock: Clock,
) {
    private val tx = TransactionTemplate(transactionManager)

    fun edit(accountId: UUID, tripId: UUID, edit: EditItinerary): Itinerary {
        trips.findPeriod(accountId, tripId) ?: throw ResourceNotFound() // 소유·존재(404 은닉)
        val current = itineraries.findByTrip(tripId).firstOrNull() ?: throw ResourceNotFound("생성된 일정이 없습니다.")
        if (current.status != ItineraryStatus.PLANNED) throw ConflictDetected(message = "확정된 일정은 수정할 수 없습니다.")
        // 생성 중(PARTIAL) 편집 금지 — 뒤이어 도착하는 2차 결과가 편집을 덮어써 조용히 유실된다(확정 차단과 같은 이유).
        if (current.generationState == GenerationState.PARTIAL) {
            throw ConflictDetected(message = "일정 생성이 진행 중입니다. 완료 후 수정할 수 있습니다.")
        }

        // 재검증(비차단) — 외부(ScheduleAgent) 호출은 트랜잭션 밖(DB 커넥션 안 물게, generate 와 동일). Fake 는 빈 목록.
        val violations = scheduleAgent.validate(edit.toOutput(current.solveMode, current.isFallback, clock.instant()))
        val flagged = reshape(current, edit, violations)
        return tx.execute {
            // before 는 트랜잭션 안에서 **다시 읽는다** — 위 재검증(외부 호출) 동안 다른 편집이 커밋됐으면
            // 트랜잭션 밖에서 읽은 값은 이미 낡았고, 이력에 실제로 일어나지 않은 전이(A→C)가 남는다.
            val beforeWrite = itineraries.findByTrip(tripId).firstOrNull() ?: current
            val saved = itineraries.replaceForTrip(tripId, flagged)
            val before = beforeWrite.toSnapshot()
            val after = saved.toSnapshot()
            // 바뀐 게 없으면 남기지 않는다 — append-only 라 한 번 쌓인 무의미한 행은 지울 수 없다.
            if (before != after) {
                // 이력은 **같은 트랜잭션**에 — 일정만 바뀌고 이력이 빠지는 상태를 만들지 않는다(US-PLANB-09).
                changeLog.append(
                    AppendChangeLog(
                        tripId = tripId,
                        actor = accountId.toString(),
                        sourceType = ChangeSourceType.MANUAL,
                        reason = edit.reason,
                        before = before,
                        after = after,
                    ),
                )
            }
            saved
        }!!
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
            current.generationState, days, current.createdAt, clock.instant(), // 생성 진행 상태는 편집과 무관 — 보존
        )
    }

    /** 일정 → 변경 이력 스냅숏. 시각·순서만 담는다(INV-3 소요시간 없음). */
    private fun Itinerary.toSnapshot() = ItinerarySnapshotView(
        days.map { d ->
            DaySnapshotView(d.date, d.slots.map { SlotSnapshotView(it.sourcePoiId, it.startAt, it.endAt, it.isFixed, it.endsNextDay) })
        },
    )
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
