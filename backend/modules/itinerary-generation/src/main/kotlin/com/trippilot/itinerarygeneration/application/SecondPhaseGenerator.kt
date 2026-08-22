package com.trippilot.itinerarygeneration.application

import com.trippilot.itinerarygeneration.domain.DaySchedule
import com.trippilot.itinerarygeneration.domain.VisitSlotDisplay
import com.trippilot.itinerarygeneration.domain.FreshnessMeta
import com.trippilot.itinerarygeneration.domain.withPlacementReason
import com.trippilot.itinerarygeneration.domain.GenerationState
import com.trippilot.itinerarygeneration.domain.Itinerary
import com.trippilot.itinerarygeneration.domain.ItineraryDay
import com.trippilot.itinerarygeneration.domain.ItineraryRepository
import com.trippilot.itinerarygeneration.domain.MinimalItineraryFallback
import com.trippilot.itinerarygeneration.domain.RevisionActor
import com.trippilot.itinerarygeneration.domain.RevisionKind
import com.trippilot.itinerarygeneration.domain.ScheduleAgentInput
import com.trippilot.itinerarygeneration.domain.UnplacedMustVisit
import com.trippilot.itinerarygeneration.domain.ScheduleAgentOutput
import com.trippilot.itinerarygeneration.domain.ScheduleAgentPort
import com.trippilot.itinerarygeneration.domain.VisitSlot
import org.slf4j.LoggerFactory
import org.springframework.scheduling.annotation.Async
import org.springframework.stereotype.Component
import org.springframework.transaction.PlatformTransactionManager
import org.springframework.transaction.support.TransactionTemplate
import java.time.Clock
import java.time.LocalDate
import java.util.UUID

/**
 * day1 조기 노출의 **2차 생성**(TRIP-267 · AI 2단계 동기 호출 합의 PR #104).
 * 1차(day1)를 즉시 노출한 뒤 나머지 일자를 백그라운드로 채운다 — AI 는 stateless 동기 REST 를 유지하고
 * 진행 상태·재시도·노출 책임은 백엔드가 진다.
 *
 * **별도 빈인 이유**: `@Async` 는 프록시로 동작해 같은 빈 내부 호출(self-invocation)에는 걸리지 않는다.
 * **경합 처리**: 2차 결과 반영은 아직 PARTIAL 인 일정에만 적용한다. 그 사이 사용자가 편집·재생성했다면
 * `completeGeneration` 이 409 를 던지므로 **덮어쓰지 않고 포기**한다(lost update 방지).
 */
@Component
class SecondPhaseGenerator(
    private val scheduleAgent: ScheduleAgentPort,
    private val itineraries: ItineraryRepository,
    private val revisions: ItineraryRevisionService,
    private val sessions: GenerationSessionService,
    transactionManager: PlatformTransactionManager,
    private val clock: Clock,
) {
    private val tx = TransactionTemplate(transactionManager)

    /**
     * 생성을 **마무리**해 PARTIAL→COMPLETE 로 전이. 실패하면 FAILED 로 표시하되 1차분(day1)은 유효하게 둔다
     * (INV-4 침묵 금지 — 사용자에게 "왜 나머지가 안 나왔는지"가 상태로 드러나야 한다).
     *
     * 두 가지를 여기서 한다 — 나머지 일자 생성(있으면)과 **추천 근거 채우기**(TRIP-511).
     * 근거를 COMPLETE **뒤에** 채우면 화면이 이미 폴링을 멈춰 영영 못 본다. 그래서 이 메서드가 끝날 때
     * "일정도 근거도 다 들어왔다"가 되도록 순서를 묶었다.
     *
     * @param secondInput 나머지 일자 생성 입력. **null 이면 하루 여행**이라 2차가 없고 근거만 채운다.
     */
    @Async
    fun completeRemaining(
        tripId: UUID,
        itineraryId: UUID,
        secondInput: ScheduleAgentInput?,
        isRegeneration: Boolean,
        /** 조립 단계에서 자리를 못 찾아 보내지도 못한 필수 방문지 — AI 보고와 합쳐 최종 목록이 된다. */
        assemblyUnplaced: List<UnplacedMustVisit> = emptyList(),
        /** 진행 상태 세션(h09·h10). 사용자가 취소했으면 결과를 버린다(BR-U3-05). */
        sessionId: UUID? = null,
    ) {
        // INV-4: 2차 실패도 1차와 **대칭**으로 결정론 최소 폴백(must_visit 고정블록)으로 채운다.
        // 실패를 이유로 나머지 일자를 비워두지 않되, solveMode=MINIMAL·isFallback 으로 저하를 드러낸다.
        val output = secondInput?.let { input ->
            try {
                scheduleAgent.generate(input)
            } catch (e: Exception) {
                log.warn("2차 생성 실패 — 결정론 최소 폴백 적용(INV-4). tripId={}", tripId, e)
                MinimalItineraryFallback.of(input, clock.instant())
            }
        }

        // 사용자가 [취소]를 눌렀으면 결과를 버린다 — 그만두겠다고 한 뒤 화면이 바뀌면 안 된다(BR-U3-05).
        if (sessionId != null && sessions.isCanceled(sessionId)) {
            log.info("2차 결과 폐기 — 사용자가 생성을 취소함. tripId={}", tripId)
            return
        }

        try {
            val applied = applyOrDiscard(tripId, itineraryId, secondInput, output, isRegeneration, assemblyUnplaced)
            sessionId?.let { sessions.completed(it, applied?.isFallback ?: false, applied?.candidatesSummary?.level) }
        } catch (e: Exception) {
            // 폴백조차 반영하지 못한 경우 — 상태로 드러낸다(침묵 금지).
            log.error("2차 결과 반영 실패 — FAILED 표시(day1 은 유효). tripId={}", tripId, e)
            markFailed(tripId, itineraryId)
            sessionId?.let { sessions.failed(it) }
        }
    }

    /**
     * 나머지 일자를 이어붙이고 **근거를 채운 뒤** 닫는다. 반영했으면 최종 일정, 버렸으면 null.
     *
     * 근거 조회는 **트랜잭션 밖**이다 — 외부 호출이라 DB 커넥션을 물면 안 되고(generate 와 동일),
     * ~10초를 커넥션 풀에서 잡고 있으면 동시 사용자에게 그대로 번진다.
     */
    private fun applyOrDiscard(
        tripId: UUID,
        itineraryId: UUID,
        secondInput: ScheduleAgentInput?,
        output: ScheduleAgentOutput?,
        isRegeneration: Boolean,
        assemblyUnplaced: List<UnplacedMustVisit>,
    ): Itinerary? {
        // 1) 현재 상태를 읽어 최종 일자 목록을 만든다(아직 쓰지 않는다).
        val current = itineraries.findByTrip(tripId).firstOrNull()
        if (current == null || !current.isPendingSecondPhase(itineraryId, tripId)) return null

        val remaining = if (output != null && secondInput != null) {
            output.toRemainingDays(current.days.size, secondInput.timeWindows.map { it.date })
        } else {
            emptyList() // 하루 여행 — 2차가 없다
        }
        val allDays = current.days + remaining

        // 2) 근거를 받아 온다. 실패는 어댑터가 빈 맵으로 접는다 — 근거가 없다고 일정을 죽이지 않는다.
        val reasons = scheduleAgent.explanations(tripId, allDays.toOutput(current, clock.instant()))
        val withReasons = allDays.map { d ->
            ItineraryDay.of(
                d.date, d.dayOrder,
                d.slots.map { slot ->
                    // 이미 있는 근거를 빈 값으로 덮지 않는다 — 조회가 일부만 답해도 있던 문장은 남는다.
                    slot.withPlacementReason(
                        BoundedText.clamp(reasons[SlotKey.of(d.date, slot.sourcePoiId)], BoundedText.PLACEMENT_REASON_MAX)
                            ?: slot.placementReason,
                    )
                },
            )
        }
        SlotKey.warnIfUnmatched(
            received = reasons.size,
            matched = withReasons.sumOf { d -> d.slots.count { it.placementReason != null } },
            tripId = tripId,
        )

        // 3) 이제 쓴다. 읽고-쓰는 사이에 재생성이 끼어들 수 있어 가드를 **다시** 본다.
        return tx.execute {
            val latest = itineraries.findByTrip(tripId).firstOrNull()
            if (latest == null || !latest.isPendingSecondPhase(itineraryId, tripId)) return@execute null

            val updated = latest.completeGeneration(
                withReasons,
                clock.instant(),
                output?.solveMode ?: latest.solveMode,
                output?.isFallback ?: latest.isFallback,
                output?.candidatesSummary ?: latest.candidatesSummary,
                // 2차는 전 일자를 보고 판정하므로 그 결과가 최종이다 — 1차(day1만) 판정으로 되돌리지 않는다.
                assemblyUnplaced + (output?.unplacedMustVisits ?: emptyList()),
            )
            // 조건부 쓰기 — 위 가드를 읽은 뒤 재생성이 끼어들었으면 여기서 0행이 되어 아무것도 덮어쓰지 않는다.
            if (!itineraries.replaceIfCurrent(tripId, itineraryId, updated)) {
                log.info("생성 마무리 폐기 — 쓰기 직전 일정이 바뀜. tripId={}", tripId)
                return@execute null
            }
            // 되돌리기 지점은 **전 일자가 담긴 최종 상태**로 남긴다 — 1차(day1)에서 남기면 복원 시 나머지가 잘린다.
            revisions.record(
                updated, RevisionActor.AI,
                if (isRegeneration) RevisionKind.GENERATE else RevisionKind.BASELINE,
                if (isRegeneration) "AI가 일정을 다시 짬" else "AI가 처음 짠 일정",
            )
            updated
        }
    }

    /** 아직 이 마무리가 반영될 자리인가 — 재생성으로 교체됐거나 상태가 바뀌었으면 아니다. */
    private fun Itinerary.isPendingSecondPhase(expected: UUID, tripId: UUID): Boolean {
        if (itineraryId != expected) {
            log.info("생성 마무리 폐기 — 일정이 교체됨. tripId={}", tripId)
            return false
        }
        if (generationState != GenerationState.PARTIAL) {
            log.info("생성 마무리 폐기 — 그 사이 일정이 바뀜(state={}). tripId={}", generationState, tripId)
            return false
        }
        return true
    }

    /** 근거 조회 입력 — 시각·순서만 담는다(INV-3: 소요시간 없음). */
    private fun List<ItineraryDay>.toOutput(current: Itinerary, at: java.time.Instant) = ScheduleAgentOutput(
        days = map { d -> DaySchedule(d.date, d.slots.map { VisitSlotDisplay(it.sourcePoiId, it.startAt, it.endAt, it.endsNextDay, null, it.isFixed) }) },
        day1ReadyAt = null, explanations = emptyMap(),
        solveMode = current.solveMode, isFallback = current.isFallback,
        freshness = FreshnessMeta(at, degraded = false),
    )

    /** 반영 실패 표시 — 이미 상태가 바뀐 일정은 건드리지 않는다. */
    private fun markFailed(tripId: UUID, itineraryId: UUID) {
        runCatching {
            tx.execute {
                val current = itineraries.findByTrip(tripId).firstOrNull() ?: return@execute null
                if (current.itineraryId != itineraryId || current.generationState != GenerationState.PARTIAL) return@execute null
                itineraries.replaceIfCurrent(tripId, itineraryId, current.failGeneration(clock.instant()))
            }
        }.onFailure { log.error("FAILED 표시조차 실패. tripId={}", tripId, it) }
    }

    /** 2차 응답 → 1차 일자 뒤에 이어지는 일자들. [offset] = 1차가 채운 일자 수(dayOrder 연속 보장). */
    private fun ScheduleAgentOutput.toRemainingDays(offset: Int, dates: List<LocalDate>): List<ItineraryDay> =
        DayReconciliation.alignTo(dates, days).mapIndexed { idx, d ->
            ItineraryDay.of(
                d.date, offset + idx,
                d.slots.mapIndexed { slotIdx, s ->
                    VisitSlot.of(
                        s.poiId, null, slotIdx, s.startAt, s.endAt, s.isFixed,
                        endsNextDay = s.endsNextDay,
                        // AI 문자열은 컬럼 상한을 넘을 수 있다 — 자르지 않으면 22001 로 생성 전체가 롤백된다.
                        distanceRange = BoundedText.clamp(s.distanceRange, BoundedText.DISTANCE_RANGE_MAX),
                        placementReason = BoundedText.clamp(
                            explanations[SlotKey.of(d.date, s.poiId)], BoundedText.PLACEMENT_REASON_MAX,
                        ),
                    )
                },
            )
        }

    companion object {
        private val log = LoggerFactory.getLogger(SecondPhaseGenerator::class.java)
    }
}
