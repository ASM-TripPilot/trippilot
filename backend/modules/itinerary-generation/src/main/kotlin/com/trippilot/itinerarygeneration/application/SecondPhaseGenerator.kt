package com.trippilot.itinerarygeneration.application

import com.trippilot.itinerarygeneration.domain.GenerationState
import com.trippilot.itinerarygeneration.domain.ItineraryDay
import com.trippilot.itinerarygeneration.domain.ItineraryRepository
import com.trippilot.itinerarygeneration.domain.MinimalItineraryFallback
import com.trippilot.itinerarygeneration.domain.ScheduleAgentInput
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
    transactionManager: PlatformTransactionManager,
    private val clock: Clock,
) {
    private val tx = TransactionTemplate(transactionManager)

    /**
     * 나머지 일자를 생성해 PARTIAL→COMPLETE 로 전이. 실패하면 FAILED 로 표시하되 1차분(day1)은 유효하게 둔다
     * (INV-4 침묵 금지 — 사용자에게 "왜 나머지가 안 나왔는지"가 상태로 드러나야 한다).
     */
    @Async
    fun completeRemaining(tripId: UUID, itineraryId: UUID, secondInput: ScheduleAgentInput) {
        // INV-4: 2차 실패도 1차와 **대칭**으로 결정론 최소 폴백(must_visit 고정블록)으로 채운다.
        // 실패를 이유로 나머지 일자를 비워두지 않되, solveMode=MINIMAL·isFallback 으로 저하를 드러낸다.
        val output = try {
            scheduleAgent.generate(secondInput)
        } catch (e: Exception) {
            log.warn("2차 생성 실패 — 결정론 최소 폴백 적용(INV-4). tripId={}", tripId, e)
            MinimalItineraryFallback.of(secondInput, clock.instant())
        }

        try {
            applyOrDiscard(tripId, itineraryId, secondInput, output)
        } catch (e: Exception) {
            // 폴백조차 반영하지 못한 경우 — 상태로 드러낸다(침묵 금지).
            log.error("2차 결과 반영 실패 — FAILED 표시(day1 은 유효). tripId={}", tripId, e)
            markFailed(tripId, itineraryId)
        }
    }

    private fun applyOrDiscard(tripId: UUID, itineraryId: UUID, secondInput: ScheduleAgentInput, output: ScheduleAgentOutput) {
        tx.execute {
            val current = itineraries.findByTrip(tripId).firstOrNull() ?: return@execute null
            if (current.itineraryId != itineraryId) { // 재생성으로 교체된 뒤 도착한 낡은 결과
                log.info("2차 결과 폐기 — 일정이 교체됨. tripId={}", tripId)
                return@execute null
            }
            if (current.generationState != GenerationState.PARTIAL) {
                log.info("2차 결과 폐기 — 그 사이 일정이 바뀜(state={}). tripId={}", current.generationState, tripId)
                return@execute null
            }
            // 1차분(day1)은 영속본 그대로 보존하고 뒤에 이어붙인다 — 이미 노출된 날을 흔들지 않는다.
            val updated = current.completeGeneration(
                current.days + output.toRemainingDays(current.days.size, secondInput.timeWindows.map { it.date }),
                clock.instant(),
                output.solveMode, output.isFallback,
            )
            // 조건부 쓰기 — 위 가드를 읽은 뒤 재생성이 끼어들었으면 여기서 0행이 되어 아무것도 덮어쓰지 않는다.
            if (!itineraries.replaceIfCurrent(tripId, itineraryId, updated)) {
                log.info("2차 결과 폐기 — 쓰기 직전 일정이 바뀜. tripId={}", tripId)
            }
        }
    }

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
                    VisitSlot.of(s.poiId, null, slotIdx, s.startAt, s.endAt, s.isFixed, endsNextDay = s.endsNextDay, distanceRange = s.distanceRange)
                },
            )
        }

    companion object {
        private val log = LoggerFactory.getLogger(SecondPhaseGenerator::class.java)
    }
}
