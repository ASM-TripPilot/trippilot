package com.trippilot.itinerarygeneration.application

import com.trippilot.core.error.ConflictDetected
import com.trippilot.core.error.ResourceNotFound
import com.trippilot.itinerarygeneration.domain.DaySnapshot
import com.trippilot.itinerarygeneration.domain.GenerationState
import com.trippilot.itinerarygeneration.domain.Itinerary
import com.trippilot.itinerarygeneration.domain.ItineraryDay
import com.trippilot.itinerarygeneration.domain.ItineraryRepository
import com.trippilot.itinerarygeneration.domain.ItineraryRevisionSummary
import com.trippilot.itinerarygeneration.domain.ItineraryRevisionRepository
import com.trippilot.itinerarygeneration.domain.ItinerarySnapshot
import com.trippilot.itinerarygeneration.domain.ItineraryStatus
import com.trippilot.itinerarygeneration.domain.NewRevision
import com.trippilot.itinerarygeneration.domain.RevisionActor
import com.trippilot.itinerarygeneration.domain.RevisionKind
import com.trippilot.itinerarygeneration.domain.SlotSnapshot
import com.trippilot.itinerarygeneration.domain.DaySchedule
import com.trippilot.itinerarygeneration.domain.FreshnessMeta
import com.trippilot.itinerarygeneration.domain.ScheduleAgentOutput
import com.trippilot.itinerarygeneration.domain.ScheduleAgentPort
import com.trippilot.itinerarygeneration.domain.Violation
import com.trippilot.itinerarygeneration.domain.VisitSlotDisplay
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
    private val scheduleAgent: ScheduleAgentPort,
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
                // 사용자 사유가 그대로 들어온다 — 컬럼 상한을 넘기면 22001 로 편집까지 롤백되고 500 이 나간다.
                summary = BoundedText.clamp(summary, BoundedText.REVISION_SUMMARY_MAX)!!,
                detail = BoundedText.clamp(detail, BoundedText.REVISION_DETAIL_MAX),
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
        if (!revisions.existsForTrip(current.tripId)) {
            // 이 일정이 이미 편집됐는지 알 수 없다(리비전 도입 이전 일정) — "AI가 처음 짠" 이라고 단정하지 않는다.
            record(current, RevisionActor.AI, RevisionKind.BASELINE, "되돌리기 지점(기존 일정)")
        }
    }

    fun list(accountId: UUID, tripId: UUID, limit: Int): List<ItineraryRevisionSummary> {
        trips.findPeriod(accountId, tripId) ?: throw ResourceNotFound()
        itineraries.findByTrip(tripId).firstOrNull() ?: throw ResourceNotFound("생성된 일정이 없습니다.")
        return revisions.findSummaries(tripId, limit.coerceIn(1, MAX_LIMIT))
    }

    /**
     * 되돌리기 — 과거 리비전을 지우지 않고 **새 리비전을 쌓는다**(BR-U3-32). 되돌리기의 되돌리기가 가능하다.
     * 고정 블록(숙소·시각 고정 필수 방문지)의 시각은 복원 스냅숏보다 **현행이 이긴다**(BR-U3-33 · INV-U3-03).
     */
    fun restore(accountId: UUID, tripId: UUID, revisionId: UUID): Itinerary {
        trips.findPeriod(accountId, tripId) ?: throw ResourceNotFound()
        val preview = itineraries.findByTrip(tripId).firstOrNull() ?: throw ResourceNotFound("생성된 일정이 없습니다.")
        requireRestorable(preview)
        val target = revisions.findById(revisionId)?.takeIf { it.tripId == tripId }
            ?: throw ResourceNotFound("해당 버전을 찾을 수 없습니다.")
        // 복원은 현재 일정을 **지우고 덮어쓰는** 동작이다. 스냅숏이 비어 있으면(형태 드리프트로 파싱 유실 포함)
        // 그대로 적용했다간 일정이 빈 채로 남는다 — 조용히 부분 적용하느니 실패로 드러낸다(INV-4).
        if (target.snapshot.days.isEmpty()) {
            throw ConflictDetected(message = "이 버전은 복원할 수 없습니다(저장된 내용을 읽지 못했습니다).")
        }

        // 복원 결과는 솔버가 만든 적 없는 조합이다(현행 고정 시각 + 과거 스냅숏). 편집과 같은 기준으로 재검증해
        // 위반을 표시한다 — 검증 안 된 시각을 hasViolation=false 로 내보내면 INV-2 를 우회하는 셈이다.
        val draftDays = target.snapshot.toDays(fixedFrom = preview)
        val violations = scheduleAgent.validate(draftDays.toOutput(preview, clock.instant()))

        return tx.execute {
            // 가드를 **트랜잭션 안에서 다시** 본다 — 위 검증(외부 호출) 동안 확정이 커밋됐으면 그 확정을 되돌리게 된다.
            val current = itineraries.findByTrip(tripId).firstOrNull() ?: throw ResourceNotFound("생성된 일정이 없습니다.")
            requireRestorable(current)

            val restoredDays = target.snapshot.toDays(fixedFrom = current, violations = violations)
            val restored = Itinerary.reconstitute(
                current.itineraryId, current.tripId, ItineraryStatus.PLANNED, current.solveMode, current.generationMode, current.isFallback,
                current.generationState, restoredDays, current.createdAt, clock.instant(), current.candidatesSummary,
            )
            // 이미 같은 내용이면 쌓지 않는다 — 목록이 같은 버전으로 도배된다(편집과 같은 기준).
            if (current.toSnapshot() == restored.toSnapshot()) return@execute current
            val saved = itineraries.replaceForTrip(tripId, restored)
            record(saved, RevisionActor.USER, RevisionKind.RESTORE, "${target.seq}번째 버전으로 되돌림", target.summary)
            saved
        }!!
    }

    private fun requireRestorable(itinerary: Itinerary) {
        if (itinerary.status != ItineraryStatus.PLANNED) throw ConflictDetected(message = "확정된 일정은 되돌릴 수 없습니다.")
        if (itinerary.generationState == GenerationState.PARTIAL) {
            throw ConflictDetected(message = "일정 생성이 진행 중입니다. 완료 후 되돌릴 수 있습니다.")
        }
    }

    /**
     * 스냅숏 → 일자. [fixedFrom] 의 고정 블록 시각이 스냅숏을 이긴다(BR-U3-33) —
     * 되돌린다고 숙소 체크인이나 시각 고정 방문지가 흔들리면 안 된다.
     */
    companion object {
        const val DEFAULT_LIMIT = 100
        const val MAX_LIMIT = 500
    }

    private fun ItinerarySnapshot.toDays(fixedFrom: Itinerary, violations: List<Violation> = emptyList()): List<ItineraryDay> {
        // (날짜, poiId) 로 맞춘다 — poiId 만으로 묶으면 같은 숙소가 여러 날 고정된 경우 마지막 날 시각으로 뭉개진다.
        val fixedNow = fixedFrom.days.flatMap { d -> d.slots.filter { it.isFixed }.map { (d.date to it.sourcePoiId) to it } }.toMap()
        val used = mutableSetOf<Pair<java.time.LocalDate, java.util.UUID>>()

        val restored = days.mapIndexed { dayIdx, d ->
            val fromSnapshot = d.slots.map { s ->
                val fixed = fixedNow[d.date to s.poiId]?.also { used += d.date to s.poiId }
                SlotDraft(
                    poiId = s.poiId,
                    startAt = fixed?.startAt ?: s.startAt,
                    endAt = fixed?.endAt ?: s.endAt,
                    isFixed = fixed != null || s.isFixed,
                    endsNextDay = fixed?.endsNextDay ?: s.endsNextDay,
                    distanceRange = s.distanceRange,
                    placementReason = s.placementReason,
                )
            }
            // 지금 고정돼 있는데 스냅숏에 없는 블록은 **되살려 붙인다** — 빠뜨리면 되돌리기가 필수 방문지를 지운다
            // (BR-U3-33 은 고정 블록이 스냅숏을 이긴다고 정한다. 누락도 그 "짐"에 포함된다.)
            val missingFixed = fixedNow.filterKeys { (date, poi) -> date == d.date && (date to poi) !in used }
                .values.map { f ->
                    SlotDraft(f.sourcePoiId, f.startAt, f.endAt, true, f.endsNextDay, f.distanceRange, f.placementReason)
                }
            (fromSnapshot + missingFixed).sortedBy { it.startAt } to d.date
        }

        return restored.mapIndexed { dayIdx, (drafts, date) ->
            ItineraryDay.of(
                date, dayIdx,
                drafts.mapIndexed { slotIdx, s ->
                    VisitSlot.of(
                        s.poiId, null, slotIdx, s.startAt, s.endAt, s.isFixed,
                        hasViolation = violations.any { it.dayIndex == dayIdx && it.slotIndex == slotIdx },
                        endsNextDay = s.endsNextDay,
                        distanceRange = s.distanceRange,
                        placementReason = s.placementReason,
                    )
                },
            )
        }
    }

    /** 복원 초안 슬롯 — 재검증 전 단계라 hasViolation 이 아직 없다. */
    private data class SlotDraft(
        val poiId: java.util.UUID,
        val startAt: java.time.LocalTime,
        val endAt: java.time.LocalTime,
        val isFixed: Boolean,
        val endsNextDay: Boolean,
        val distanceRange: String?,
        val placementReason: String?,
    )

    /** 재검증 입력 — 시각·순서만. 거리·소요시간 없음(INV-3). */
    private fun List<ItineraryDay>.toOutput(current: Itinerary, at: java.time.Instant) = ScheduleAgentOutput(
        days = map { d -> DaySchedule(d.date, d.slots.map { VisitSlotDisplay(it.sourcePoiId, it.startAt, it.endAt, it.endsNextDay, null, it.isFixed) }) },
        day1ReadyAt = null, explanations = emptyMap(),
        solveMode = current.solveMode, isFallback = current.isFallback,
        freshness = FreshnessMeta(at, degraded = false),
    )
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