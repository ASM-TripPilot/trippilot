package com.trippilot.itinerarygeneration.application

import com.trippilot.core.error.ConflictDetected
import com.trippilot.core.error.ResourceNotFound
import com.trippilot.itinerarygeneration.api.ReplanCommand
import com.trippilot.itinerarygeneration.api.ReplanFacade
import com.trippilot.itinerarygeneration.api.ReplanProposal
import com.trippilot.itinerarygeneration.api.ReplanSlot
import com.trippilot.itinerarygeneration.domain.Itinerary
import com.trippilot.itinerarygeneration.domain.ItineraryDay
import com.trippilot.itinerarygeneration.domain.ItineraryRepository
import com.trippilot.itinerarygeneration.domain.ItineraryStatus
import com.trippilot.itinerarygeneration.domain.ReplanInput
import com.trippilot.itinerarygeneration.domain.ReplanScope
import com.trippilot.itinerarygeneration.domain.RequestMeta
import com.trippilot.itinerarygeneration.domain.RevisionActor
import com.trippilot.itinerarygeneration.domain.RevisionKind
import com.trippilot.itinerarygeneration.domain.ScheduleAgentPort
import com.trippilot.itinerarygeneration.domain.VisitSlot
import com.trippilot.trip.api.TripFacade
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import java.time.Clock
import java.time.LocalTime
import java.time.ZoneId
import java.util.UUID

/**
 * [ReplanFacade] 구현 — AI 경계 호출과 일정 쓰기를 C8 안에 둔다.
 *
 * 세션·사용자 입력은 C10(재계획) 소유이고, 여기는 **"이 잠금으로 다시 짜고, 확정되면 반영한다"**만 한다.
 * 두 책임을 갈라 두는 이유는 INV-U4-05 다 — 확정 전 쓰기가 없다는 것을 보장하려면 쓰는 곳이 한 군데여야 한다.
 */
@Service
class ReplanFacadeService(
    private val trips: TripFacade,
    private val itineraries: ItineraryRepository,
    private val scheduleAgent: ScheduleAgentPort,
    private val revisions: ItineraryRevisionService,
    private val clock: Clock,
) : ReplanFacade {

    /** 산출은 **읽기 전용**이다 — 여기서 일정에 손대면 [취소]가 원상복구를 보장하지 못한다(INV-U4-05). */
    @Transactional(readOnly = true)
    override fun propose(command: ReplanCommand): ReplanProposal? {
        val current = ownedItinerary(command.accountId, command.tripId)
        val output = scheduleAgent.replan(
            ReplanInput(
                tripId = command.tripId,
                itineraryId = current.itineraryId,
                scope = if (command.fullDay) ReplanScope.FULL_DAY else ReplanScope.PARTIAL_SLOTS,
                fromInstant = command.fromInstant,
                targetDate = command.targetDate,
                originLat = command.originLat,
                originLng = command.originLng,
                lockedSlotKeys = lockedKeys(current, command),
                reasons = command.reasons,
                directives = command.directives,
                freeText = command.freeText,
                excludedPoiIds = command.excludedPoiIds,
                requestMeta = RequestMeta(UUID.randomUUID().toString(), clock.instant(), REPLAN_DEADLINE_MS),
            ),
        )
        val day = output.days.firstOrNull { it.date == command.targetDate } ?: output.days.firstOrNull()
        val slots = day?.slots.orEmpty().map {
            ReplanSlot(
                poiId = it.poiId, startAt = it.startAt, endAt = it.endAt, isFixed = it.isFixed,
                endsNextDay = it.endsNextDay, distanceRange = it.distanceRange,
                placementReason = output.explanations["${command.targetDate}#${it.poiId}"],
            )
        }
        // 빈 초안은 "해 없음"이다 — 빈 하루를 초안이라고 보여 주면 사용자가 그걸 확정한다.
        if (slots.isEmpty()) return null
        return ReplanProposal(current.itineraryId, command.targetDate, slots)
    }

    /**
     * 다시 짜도 그대로여야 하는 슬롯(INV-U4-04):
     * - **완료** — 이미 다녀왔다. 지우면 실적과 계획이 어긋난다(C10 이 알려 준다)
     * - **시각 고정** — 예약처럼 시각이 정해진 것(HC3)
     * - **지금 이전** — '지금 이후만' 범위일 때. 오늘 전체를 다시 짜도 지나간 시각을 새로 채우지는 않는다
     *
     * 잠금을 빠뜨리면 이미 다녀온 곳이 일정에서 사라지거나 예약 시각이 밀린다.
     */
    private fun lockedKeys(current: Itinerary, command: ReplanCommand): List<String> {
        val day = current.days.firstOrNull { it.date == command.targetDate } ?: return command.completedSlotKeys
        val now = LocalTime.ofInstant(command.fromInstant, TRAVEL_ZONE)
        val fromDay = day.slots
            .filter { it.isFixed || (!command.fullDay && it.startAt < now) }
            .map { "${command.targetDate}#${it.sourcePoiId}" }
        return (command.completedSlotKeys + fromDay).distinct()
    }

    /**
     * 초안을 일정에 반영 — **대상 일자만** 교체하고 나머지 일자는 손대지 않는다.
     * 되돌릴 지점을 먼저 남긴다(BR-U3-19) — 반영 후에 남기면 그 시점으로 못 돌아간다.
     */
    @Transactional
    override fun apply(accountId: UUID, tripId: UUID, proposal: ReplanProposal) {
        val current = ownedItinerary(accountId, tripId)
        if (current.itineraryId != proposal.itineraryId) {
            // 그 사이 재생성으로 일정이 교체됐다 — 낡은 초안을 덮어쓰면 방금 만든 일정이 사라진다.
            throw ConflictDetected(message = "그 사이 일정이 바뀌었습니다. 다시 재계획해 주세요.")
        }
        if (current.status == ItineraryStatus.CONFIRMED) {
            throw ConflictDetected(message = "확정된 일정은 재계획을 반영할 수 없습니다.")
        }
        revisions.ensureRestorePoint(current)

        val replaced = current.days.map { day ->
            if (day.date != proposal.date) day else ItineraryDay.of(day.date, day.dayOrder, proposal.slots.toSlots())
        }
        val next = Itinerary.reconstitute(
            itineraryId = current.itineraryId, tripId = current.tripId, status = current.status,
            solveMode = current.solveMode, generationMode = current.generationMode, isFallback = current.isFallback,
            generationState = current.generationState, days = replaced,
            createdAt = current.createdAt, updatedAt = clock.instant(),
            candidatesSummary = current.candidatesSummary, unplacedMustVisits = current.unplacedMustVisits,
        )
        val saved = itineraries.replaceForTrip(tripId, next)
        revisions.record(saved, RevisionActor.AI, RevisionKind.EDIT, "여행 중 재계획 반영")
    }

    private fun List<ReplanSlot>.toSlots(): List<VisitSlot> = mapIndexed { i, s ->
        VisitSlot.of(
            sourcePoiId = s.poiId, poiSnapshotId = null, orderIndex = i,
            startAt = s.startAt, endAt = s.endAt, isFixed = s.isFixed, endsNextDay = s.endsNextDay,
            distanceRange = s.distanceRange, placementReason = s.placementReason,
        )
    }

    /** 소유·존재 검증(404 은닉). 일정이 없으면 재계획 대상 자체가 없다. */
    private fun ownedItinerary(accountId: UUID, tripId: UUID): Itinerary {
        trips.findPeriod(accountId, tripId) ?: throw ResourceNotFound()
        return itineraries.findByTrip(tripId).firstOrNull() ?: throw ResourceNotFound("일정이 없습니다.")
    }

    private companion object {
        /** 사용자가 화면에서 기다리는 동작이라 생성(20s)보다 짧게 잡는다. */
        private const val REPLAN_DEADLINE_MS = 10_000L

        /** 여행 "지금"은 사용자가 있는 곳의 시각이다(서버 UTC 아님). */
        private val TRAVEL_ZONE: ZoneId = ZoneId.of("Asia/Seoul")
    }
}
