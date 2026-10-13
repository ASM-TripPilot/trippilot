package com.trippilot.itinerarygeneration.application

import com.trippilot.core.error.FieldError
import com.trippilot.core.error.ResourceNotFound
import com.trippilot.core.error.ValidationFailed
import com.trippilot.itinerarygeneration.api.EditProposal
import com.trippilot.itinerarygeneration.api.EditProposalRequest
import com.trippilot.itinerarygeneration.api.ItineraryEditProposalFacade
import com.trippilot.itinerarygeneration.api.ProposalViolation
import com.trippilot.itinerarygeneration.api.ProposedDay
import com.trippilot.itinerarygeneration.api.ProposedSlot
import com.trippilot.itinerarygeneration.domain.DaySchedule
import com.trippilot.itinerarygeneration.domain.EditCommand
import com.trippilot.itinerarygeneration.domain.EditProposalInput
import com.trippilot.itinerarygeneration.domain.EditProposalOutput
import com.trippilot.itinerarygeneration.domain.EditProposalStatus
import com.trippilot.itinerarygeneration.domain.FreshnessMeta
import com.trippilot.itinerarygeneration.domain.Itinerary
import com.trippilot.itinerarygeneration.domain.ItineraryRepository
import com.trippilot.itinerarygeneration.domain.RequestMeta
import com.trippilot.itinerarygeneration.domain.ScheduleAgentOutput
import com.trippilot.itinerarygeneration.domain.ScheduleAgentPort
import com.trippilot.itinerarygeneration.domain.VisitSlotDisplay
import com.trippilot.trip.api.TripFacade
import org.slf4j.LoggerFactory
import org.springframework.stereotype.Service
import java.time.Clock
import java.time.LocalDate
import java.util.UUID
import java.util.concurrent.CompletableFuture
import java.util.concurrent.ExecutionException
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.TimeoutException

/**
 * 편집 제안(U8 G-U8-2) — 저장된 일정을 상대에 보내 "이렇게 바꾼 안"을 받아 온다. **쓰기가 없다**(트랜잭션도 없다).
 *
 * 실패는 전부 [EditProposal.Unavailable] 로 접는다 — 이 경계의 실패는 **일정 폴백 신호가 아니다**(FD §3.2).
 * 생성 경로처럼 최소 일정으로 내려가면 말 한마디에 일정이 갈아엎어진다.
 */
@Service
class EditProposalService(
    private val trips: TripFacade,
    private val itineraries: ItineraryRepository,
    private val scheduleAgent: ScheduleAgentPort,
    private val contexts: RepairContexts,
    private val clock: Clock,
) : ItineraryEditProposalFacade {

    override fun propose(accountId: UUID, tripId: UUID, targetDate: LocalDate, request: EditProposalRequest, deadlineMs: Long): EditProposal {
        require(deadlineMs > 0) { "deadlineMs 는 양수여야 한다." }
        trips.findPeriod(accountId, tripId) ?: throw ResourceNotFound() // 소유·존재(404 은닉)
        val current = itineraries.findByTrip(tripId).firstOrNull() ?: throw ResourceNotFound("생성된 일정이 없습니다.")
        val day = current.days.firstOrNull { it.date == targetDate }
            ?: throw ValidationFailed(listOf(FieldError("targetDate", "일정에 없는 날짜입니다.")))

        val (utterance, command) = when (request) {
            is EditProposalRequest.Utterance -> {
                if (request.text.isBlank() || request.text.length > MAX_UTTERANCE_LENGTH) {
                    throw ValidationFailed(listOf(FieldError("text", "1~${MAX_UTTERANCE_LENGTH}자여야 합니다.")))
                }
                request.text to null
            }
            is EditProposalRequest.ReplaceSlot -> {
                val (date, oldPoiId) = SlotKey.parse(request.slotKey)
                    ?: throw ValidationFailed(listOf(FieldError("slotKey", "형식이 올바르지 않습니다.")))
                if (date != targetDate || day.slots.none { it.sourcePoiId == oldPoiId }) {
                    throw ValidationFailed(listOf(FieldError("slotKey", "그 날 일정에 없는 슬롯입니다.")))
                }
                null to EditCommand.replaceSlot(oldPoiId, request.newPoiId)
            }
        }

        // 컨텍스트 조회 실패도 "지금은 제안할 수 없다"다 — 예외로 올리면 대화 턴이 500 으로 끝난다.
        val context = runCatching { contexts.forEditProposal(accountId, tripId, targetDate) }
            .onFailure { log.warn("편집 제안 컨텍스트(앵커·취향) 조회 실패. tripId={}", tripId, it) }
            .getOrNull()
            ?: return EditProposal.Unavailable.also { log.warn("편집 제안 불가 — 그 날의 앵커를 정하지 못했습니다. tripId={} date={}", tripId, targetDate) }

        val input = EditProposalInput(
            tripId = tripId,
            itinerary = current.toOutput(),
            targetDate = targetDate,
            anchorLat = context.anchor.lat,
            anchorLng = context.anchor.lng,
            budgetLevel = context.budgetTier,
            transportMode = context.transportMode,
            utterance = utterance,
            command = command,
            requestMeta = RequestMeta(UUID.randomUUID().toString(), clock.instant(), deadlineMs),
        )
        val output = within(deadlineMs, tripId) { scheduleAgent.proposeEdit(input) } ?: return EditProposal.Unavailable
        return output.toApi(tripId)
    }

    /**
     * [deadlineMs] 안에 끝나지 않으면 기다리기를 그만둔다. 상대도 같은 값을 계산 예산으로 받지만, 응답이 아예
     * 멎으면 소켓 상한(편집용 클라이언트 60초대)까지 붙잡혀 대화 턴 예산을 넘긴다.
     */
    private fun within(deadlineMs: Long, tripId: UUID, call: () -> EditProposalOutput): EditProposalOutput? {
        // ponytail: 시한을 넘긴 호출은 끊지 않고 버린다 — 가상 스레드 하나가 소켓 상한까지 남는다.
        // 계정당 분당 20턴 상한 아래에서는 무해하다. 쌓이는 것이 보이면 요청별 read timeout 으로 바꾼다.
        val future = CompletableFuture.supplyAsync(call, EXECUTOR)
        return try {
            future.get(deadlineMs, TimeUnit.MILLISECONDS)
        } catch (e: TimeoutException) {
            log.warn("편집 제안이 시한({}ms)을 넘겼습니다. tripId={}", deadlineMs, tripId)
            null
        } catch (e: ExecutionException) {
            // 상대 미도달·스키마 불일치·정본에 없는 장소 — 전부 "지금은 제안할 수 없다"(INV-4: 로그로 드러낸다).
            log.warn("편집 제안 호출 실패. tripId={}", tripId, e.cause)
            null
        }
    }

    private fun EditProposalOutput.toApi(tripId: UUID): EditProposal = when (status) {
        EditProposalStatus.PROPOSED -> EditProposal.Proposed(
            requireNotNull(itinerary) { "PROPOSED 인데 일정이 없다 — 어댑터가 지켜야 하는 불변식이다." }.days.map { d ->
                ProposedDay(d.date, d.slots.map { ProposedSlot(it.poiId, it.startAt, it.endAt, it.isFixed, it.endsNextDay, it.distanceRange) })
            },
            applyMode,
        )
        EditProposalStatus.REJECTED -> {
            log.info("편집 제안 거절 — reason={} 위반={}건 tripId={}", reason, violations.size, tripId)
            EditProposal.Rejected(
                violations.map { v ->
                    ProposalViolation(
                        v.slotRef?.let { runCatching { UUID.fromString(it) }.getOrNull() },
                        requireNotNull(ViolationText.reasonOf(listOf(v))),
                    )
                },
            )
        }
        EditProposalStatus.NOT_UNDERSTOOD -> EditProposal.NotUnderstood
    }

    /** 저장된 일정 → 상대에 보낼 본문. 편집 재검증과 같은 사영이다(시각·순서·고정만 — 거리는 상대가 다시 낸다). */
    private fun Itinerary.toOutput() = ScheduleAgentOutput(
        days = days.map { d ->
            DaySchedule(d.date, d.slots.map { VisitSlotDisplay(it.sourcePoiId, it.startAt, it.endAt, it.endsNextDay, null, it.isFixed) })
        },
        day1ReadyAt = null,
        explanations = emptyMap(),
        solveMode = solveMode,
        isFallback = isFallback,
        freshness = FreshnessMeta(clock.instant(), degraded = false),
    )

    companion object {
        /** 상대 계약 `utterance.maxLength`. 여기서 먼저 막는다 — 넘기면 상대 422 가 "AI 불통"으로 보인다. */
        const val MAX_UTTERANCE_LENGTH = 500
        private val EXECUTOR = Executors.newVirtualThreadPerTaskExecutor()
        private val log = LoggerFactory.getLogger(EditProposalService::class.java)
    }
}
