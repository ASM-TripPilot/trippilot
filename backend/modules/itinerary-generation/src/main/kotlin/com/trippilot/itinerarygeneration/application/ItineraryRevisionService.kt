package com.trippilot.itinerarygeneration.application

import com.trippilot.core.error.ConflictDetected
import com.trippilot.core.error.ResourceNotFound
import com.trippilot.itinerarygeneration.domain.DaySnapshot
import com.trippilot.itinerarygeneration.domain.GenerationState
import com.trippilot.itinerarygeneration.domain.Itinerary
import com.trippilot.itinerarygeneration.domain.ItineraryDay
import com.trippilot.itinerarygeneration.domain.ItineraryRepository
import com.trippilot.itinerarygeneration.domain.ItineraryRevision
import com.trippilot.itinerarygeneration.domain.ItineraryRevisionRepository
import com.trippilot.itinerarygeneration.domain.ItinerarySnapshot
import com.trippilot.itinerarygeneration.domain.ItineraryStatus
import com.trippilot.itinerarygeneration.domain.NewRevision
import com.trippilot.itinerarygeneration.domain.RevisionActor
import com.trippilot.itinerarygeneration.domain.RevisionKind
import com.trippilot.itinerarygeneration.domain.SlotSnapshot
import com.trippilot.itinerarygeneration.domain.VisitSlot
import com.trippilot.trip.api.TripFacade
import org.springframework.stereotype.Service
import org.springframework.transaction.PlatformTransactionManager
import org.springframework.transaction.support.TransactionTemplate
import java.time.Clock
import java.util.UUID

/**
 * 일정 편집 이력·되돌리기(TRIP-310 · DEC-U3-1).
 * U3 가 소유하는 이력은 **사용자 편집 + AI 생성 기준 버전**뿐 — Plan-B 는 U4, 아카이브 change-log 는 U5(C12).
 *
 * 기록 규칙: **행동 뒤 결과 상태**를 리비전으로 남긴다. 그래야 목록의 모든 항목이 "사용자가 실제로 본 버전"이 되고
 * 되돌리기 대상이 된다. 재생성 직전에 리비전이 하나도 없으면 현재 상태를 BASELINE 으로 먼저 남겨
 * **되돌리기 지점 없는 재생성이 0** 이 되게 한다(INV-U3-08 · BR-U3-19).
 */
@Service
class ItineraryRevisionService(
    private val revisions: ItineraryRevisionRepository,
    private val itineraries: ItineraryRepository,
    private val trips: TripFacade,
    transactionManager: PlatformTransactionManager,
    private val clock: Clock,
) {
    private val tx = TransactionTemplate(transactionManager)

    /** 행동 결과 상태를 기록. 호출자의 트랜잭션에 참여한다(일정만 바뀌고 이력이 빠지는 상태 금지). */
    fun record(itinerary: Itinerary, actor: RevisionActor, kind: RevisionKind, summary: String, detail: String? = null) {
        revisions.append(
            NewRevision(
                tripId = itinerary.tripId,
                itineraryId = itinerary.itineraryId,
                actor = actor,
                kind = kind,
                summary = summary,
                detail = detail,
                snapshot = itinerary.toSnapshot(),
                createdAt = clock.instant(),
            ),
        )
    }

    /**
     * 재생성 전 보증 — 되돌아갈 지점이 없으면 현재 상태를 BASELINE 으로 남긴다(INV-U3-08).
     * 리비전 도입 이전에 만들어진 일정도 이 경로로 되돌리기 지점을 얻는다.
     */
    fun ensureRestorePoint(current: Itinerary) {
        if (revisions.findByTrip(current.tripId).isEmpty()) {
            record(current, RevisionActor.AI, RevisionKind.BASELINE, "AI가 처음 짠 일정")
        }
    }

    fun list(accountId: UUID, tripId: UUID): List<ItineraryRevision> {
        trips.findPeriod(accountId, tripId) ?: throw ResourceNotFound()
        itineraries.findByTrip(tripId).firstOrNull() ?: throw ResourceNotFound("생성된 일정이 없습니다.")
        return revisions.findByTrip(tripId)
    }

    /**
     * 되돌리기 — 과거 리비전을 지우지 않고 **새 리비전을 쌓는다**(BR-U3-32). 되돌리기의 되돌리기가 가능하다.
     * 고정 블록(숙소·시각 고정 필수 방문지)의 시각은 복원 스냅숏보다 **현행이 이긴다**(BR-U3-33 · INV-U3-03).
     */
    fun restore(accountId: UUID, tripId: UUID, revisionId: UUID): Itinerary {
        trips.findPeriod(accountId, tripId) ?: throw ResourceNotFound()
        val current = itineraries.findByTrip(tripId).firstOrNull() ?: throw ResourceNotFound("생성된 일정이 없습니다.")
        if (current.status != ItineraryStatus.PLANNED) throw ConflictDetected(message = "확정된 일정은 되돌릴 수 없습니다.")
        if (current.generationState == GenerationState.PARTIAL) {
            throw ConflictDetected(message = "일정 생성이 진행 중입니다. 완료 후 되돌릴 수 있습니다.")
        }
        val target = revisions.findById(revisionId)?.takeIf { it.tripId == tripId }
            ?: throw ResourceNotFound("해당 버전을 찾을 수 없습니다.")

        val restoredDays = target.snapshot.toDays(fixedFrom = current)
        val restored = Itinerary.reconstitute(
            current.itineraryId, current.tripId, ItineraryStatus.PLANNED, current.solveMode, current.isFallback,
            current.generationState, restoredDays, current.createdAt, clock.instant(), current.candidatesSummary,
        )
        return tx.execute {
            val saved = itineraries.replaceForTrip(tripId, restored)
            record(saved, RevisionActor.USER, RevisionKind.RESTORE, "${target.seq}번째 버전으로 되돌림", target.summary)
            saved
        }!!
    }

    /**
     * 스냅숏 → 일자. [fixedFrom] 의 고정 블록 시각이 스냅숏을 이긴다(BR-U3-33) —
     * 되돌린다고 숙소 체크인이나 시각 고정 방문지가 흔들리면 안 된다.
     */
    private fun ItinerarySnapshot.toDays(fixedFrom: Itinerary): List<ItineraryDay> {
        val fixedByPoi = fixedFrom.days.flatMap { it.slots }.filter { it.isFixed }.associateBy { it.sourcePoiId }
        return days.mapIndexed { dayIdx, d ->
            ItineraryDay.of(
                d.date, dayIdx,
                d.slots.mapIndexed { slotIdx, s ->
                    val fixed = fixedByPoi[s.poiId]
                    VisitSlot.of(
                        s.poiId, null, slotIdx,
                        startAt = fixed?.startAt ?: s.startAt,
                        endAt = fixed?.endAt ?: s.endAt,
                        isFixed = fixed != null || s.isFixed,
                        endsNextDay = fixed?.endsNextDay ?: s.endsNextDay,
                        distanceRange = s.distanceRange,
                        placementReason = s.placementReason,
                    )
                },
            )
        }
    }
}

/** 일정 → 복원용 스냅숏. 표시값 전부를 담는다 — 하나라도 빠지면 되돌린 순간 그 값이 사라진다. */
fun Itinerary.toSnapshot(): ItinerarySnapshot = ItinerarySnapshot(
    days.map { d ->
        DaySnapshot(
            d.date,
            d.slots.map {
                SlotSnapshot(it.sourcePoiId, it.startAt, it.endAt, it.isFixed, it.endsNextDay, it.distanceRange, it.placementReason)
            },
        )
    },
)
