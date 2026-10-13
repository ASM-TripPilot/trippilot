package com.trippilot.itinerarygeneration.application

import com.trippilot.core.error.ConflictDetected
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
import com.trippilot.itinerarygeneration.domain.ItineraryStatus
import com.trippilot.itinerarygeneration.domain.RequestMeta
import com.trippilot.itinerarygeneration.domain.ScheduleAgentOutput
import com.trippilot.itinerarygeneration.domain.ScheduleAgentPort
import com.trippilot.itinerarygeneration.domain.VisitSlotDisplay
import com.trippilot.placedata.api.PoiSurfaceFacade
import com.trippilot.trip.api.TripFacade
import org.slf4j.LoggerFactory
import org.springframework.stereotype.Service
import java.time.Clock
import java.time.LocalDate
import java.time.ZoneId
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
    private val poiSurfaces: PoiSurfaceFacade,
    private val clock: Clock,
) : ItineraryEditProposalFacade {

    override fun propose(accountId: UUID, tripId: UUID, targetDate: LocalDate, request: EditProposalRequest, deadlineMs: Long): EditProposal {
        val period = trips.findPeriod(accountId, tripId) ?: throw ResourceNotFound() // 소유·존재(404 은닉)
        val current = itineraries.findByTrip(tripId).firstOrNull() ?: throw ResourceNotFound("생성된 일정이 없습니다.")
        // 저장 경로와 **같은 잠금**이다(EditItineraryService — 여행 시작 전 확정 일정). 여기서 안 막으면 LLM 을 쓰고
        // [적용]이 반드시 409 인 카드를 만든다. 생성 중(PARTIAL)은 막지 않는다 — 이미 있는 날은 저장도 받는다.
        if (current.status == ItineraryStatus.CONFIRMED && LocalDate.ofInstant(clock.instant(), TRAVEL_ZONE) < period.startDate) {
            throw ConflictDetected(message = "확정된 일정은 수정할 수 없습니다.")
        }
        val day = current.days.firstOrNull { it.date == targetDate }
            ?: throw ValidationFailed(listOf(FieldError("targetDate", "일정에 없는 날짜입니다.")))

        var replacement: UUID? = null
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
                // 슬롯 키가 `{date}#{poiId}` 라 같은 날 같은 장소가 둘이면 어느 슬롯인지 가릴 수 없다(BR-U2-04). 상대는 막지 않는다.
                if (day.slots.any { it.sourcePoiId == request.newPoiId }) {
                    throw ValidationFailed(listOf(FieldError("newPoiId", "이미 그 날 일정에 있는 장소입니다.")))
                }
                replacement = request.newPoiId
                null to EditCommand.replaceSlot(oldPoiId, request.newPoiId)
            }
        }

        // 상대에 줄 계산 예산 — 왕복 여유를 뺀다. 같은 값을 주면 예산을 다 쓴 답이 도착 직전에 버려지고 LLM 값만 나간다.
        val aiBudgetMs = deadlineMs - ROUND_TRIP_MARGIN_MS
        if (aiBudgetMs <= 0) {
            log.info("편집 제안 불가 — 남은 시한({}ms)으로는 부를 수 없습니다. tripId={}", deadlineMs, tripId)
            return EditProposal.Unavailable
        }

        // 컨텍스트 조회 실패도 "지금은 제안할 수 없다"다 — 예외로 올리면 대화 턴이 500 으로 끝난다.
        val dayContext = runCatching { contexts.forEditProposal(accountId, tripId, targetDate) }
            .onFailure { log.warn("편집 제안 컨텍스트(앵커·취향) 조회 실패. tripId={}", tripId, it) }
            .getOrNull()
            ?: return EditProposal.Unavailable.also { log.warn("편집 제안 불가 — 그 날의 앵커를 정하지 못했습니다. tripId={} date={}", tripId, targetDate) }
        val context = replacement?.let { poi -> dayContext.centeredOn(poi, tripId) ?: return EditProposal.Unavailable } ?: dayContext

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
            requestMeta = RequestMeta(UUID.randomUUID().toString(), clock.instant(), aiBudgetMs),
        )
        val output = within(deadlineMs, tripId) { scheduleAgent.proposeEdit(input) } ?: return EditProposal.Unavailable
        return output.toApi(current, replacement?.let { it to targetDate }, tripId)
    }

    /**
     * 교체 제안의 후보 풀 중심을 **새 장소**로 옮기고 예산 등급을 뗀다.
     *
     * 상대는 앵커 둘레의 후보 풀 안에 새 장소가 있어야 교체를 받는다(INV-1). 그 날의 숙소를 중심으로 두면 풀 반경이
     * 수단에 따라 1~14km 라, **우리가 슬롯 후보로 내준 곳**(교체 대상 자리 둘레 · 예산 미지정)이 숙소에서 멀다는
     * 이유로 "후보 풀 밖" 거절이 난다. 새 장소 자체를 중심에 두면 반경 탓의 거절이 없고, 예산을 떼면 후보를 고를 때와
     * 같은 풀이 된다. 실재 여부는 응답을 받은 어댑터가 정본에 다시 대조한다.
     */
    private fun EditProposalContext.centeredOn(poiId: UUID, tripId: UUID): EditProposalContext? {
        val surface = runCatching { poiSurfaces.findSurfaces(listOf(poiId))[poiId] }
            .onFailure { log.warn("편집 제안 — 새 장소 좌표 조회 실패. tripId={}", tripId, it) }
            .getOrNull()
        if (surface == null) {
            log.warn("편집 제안 불가 — 새 장소의 좌표를 모릅니다. tripId={} poiId={}", tripId, poiId)
            return null
        }
        return copy(anchor = anchor.copy(lat = surface.lat, lng = surface.lng), budgetTier = null)
    }

    /**
     * [deadlineMs] 안에 끝나지 않으면 기다리기를 그만둔다. 상대도 같은 값을 계산 예산으로 받지만, 응답이 아예
     * 멎으면 소켓 상한(편집용 클라이언트 60초대)까지 붙잡혀 대화 턴 예산을 넘긴다.
     */
    private fun within(deadlineMs: Long, tripId: UUID, call: () -> EditProposalOutput): EditProposalOutput? {
        // ponytail: 시한을 넘긴 호출은 끊지 않고 버린다 — 가상 스레드 하나와 소켓 하나(상대 쪽에서는 작업 하나)가
        // 편집용 클라이언트의 read 상한까지 남는다. 턴 수는 도우미의 분당 상한(BR-U8-24, TRIP-1378)이 묶는다.
        // 쌓이는 것이 보이면 요청별 read timeout 으로 바꾼다.
        val future = CompletableFuture.supplyAsync(call, EXECUTOR)
        return try {
            future.get(deadlineMs, TimeUnit.MILLISECONDS)
        } catch (e: TimeoutException) {
            log.warn("편집 제안이 시한({}ms)을 넘겼습니다. tripId={}", deadlineMs, tripId)
            null
        } catch (e: InterruptedException) {
            Thread.currentThread().interrupt()
            log.warn("편집 제안 대기가 중단됐습니다. tripId={}", tripId)
            null
        } catch (e: ExecutionException) {
            // 상대 미도달·스키마 불일치·정본에 없는 장소 — 전부 "지금은 제안할 수 없다"(INV-4: 로그로 드러낸다).
            log.warn("편집 제안 호출 실패. tripId={}", tripId, e.cause)
            null
        }
    }

    /** @param replaced 교체 명령의 (새 장소, 그 날) — 거절된 위반이 새 장소를 가리킬 때 날짜를 붙이는 데 쓴다. */
    private fun EditProposalOutput.toApi(base: Itinerary, replaced: Pair<UUID, LocalDate>?, tripId: UUID): EditProposal = when (status) {
        EditProposalStatus.PROPOSED -> EditProposal.Proposed(
            baseDays = base.days.map { d ->
                ProposedDay(d.date, d.slots.map { ProposedSlot(it.sourcePoiId, it.startAt, it.endAt, it.isFixed, it.endsNextDay, it.distanceRange) })
            },
            days = requireNotNull(itinerary) { "PROPOSED 인데 일정이 없다 — 어댑터가 지켜야 하는 불변식이다." }.days.map { d ->
                ProposedDay(d.date, d.slots.map { ProposedSlot(it.poiId, it.startAt, it.endAt, it.isFixed, it.endsNextDay, it.distanceRange) })
            },
            applyHint = applyMode,
        )
        EditProposalStatus.REJECTED -> {
            log.info("편집 제안 거절 — reason={} 위반={}건 tripId={}", reason, violations.size, tripId)
            EditProposal.Rejected(
                violations.map { v ->
                    val poiId = v.slotRef?.let { runCatching { UUID.fromString(it) }.getOrNull() }
                    // 상대는 장소만 알려 준다. 새 장소면 고치려던 날이고, 아니면 그 장소가 놓인 날 — 하나일 때만.
                    val date = when (poiId) {
                        null -> null
                        replaced?.first -> replaced.second
                        else -> base.days.filter { d -> d.slots.any { it.sourcePoiId == poiId } }.singleOrNull()?.date
                    }
                    ProposalViolation(poiId, date, requireNotNull(ViolationText.reasonOf(listOf(v))))
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

        /** 상대의 계산 예산에서 빼 두는 왕복·직렬화 여유. 어댑터의 read 여유(`readTimeoutMarginMs`)와 같은 취지다. */
        const val ROUND_TRIP_MARGIN_MS = 500L
        private val TRAVEL_ZONE: ZoneId = ZoneId.of("Asia/Seoul")
        private val EXECUTOR = Executors.newVirtualThreadPerTaskExecutor()
        private val log = LoggerFactory.getLogger(EditProposalService::class.java)
    }
}
