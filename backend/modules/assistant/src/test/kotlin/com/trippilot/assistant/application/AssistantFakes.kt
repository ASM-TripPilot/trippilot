package com.trippilot.assistant.application

import com.trippilot.assistant.domain.AssistantMessage
import com.trippilot.assistant.domain.AssistantMessageRepository
import com.trippilot.assistant.domain.AssistantProposal
import com.trippilot.assistant.domain.AssistantProposalRepository
import com.trippilot.assistant.domain.NewProposal
import com.trippilot.assistant.domain.ProposalStatus
import com.trippilot.assistant.domain.AssistantSession
import com.trippilot.assistant.domain.AssistantSessionRepository
import com.trippilot.assistant.domain.AssistantUsageRepository
import com.trippilot.assistant.domain.DialogueMemoryPort
import com.trippilot.assistant.domain.FeedbackRating
import com.trippilot.assistant.domain.FeedbackTarget
import com.trippilot.assistant.domain.MemoryItem
import com.trippilot.assistant.domain.MessageRole
import com.trippilot.assistant.domain.NewMessage
import com.trippilot.assistant.domain.QuickReply
import com.trippilot.assistant.domain.RecordedTurn
import com.trippilot.core.error.ConflictDetected
import com.trippilot.core.error.ErrorCode
import com.trippilot.itinerarygeneration.api.EditDayCommand
import com.trippilot.itinerarygeneration.api.EditProposal
import com.trippilot.itinerarygeneration.api.EditProposalRequest
import com.trippilot.itinerarygeneration.api.ItineraryEditFacade
import com.trippilot.itinerarygeneration.api.ItineraryEditProposalFacade
import com.trippilot.itinerarygeneration.api.ItineraryEditResult
import com.trippilot.itinerarygeneration.api.ItineraryEditSource
import com.trippilot.itinerarygeneration.api.ItineraryFacade
import com.trippilot.itinerarygeneration.api.ProposedSlot
import com.trippilot.itinerarygeneration.api.SlotCandidateFacade
import com.trippilot.itinerarygeneration.api.SlotCandidatesView
import com.trippilot.itinerarygeneration.api.ItineraryPlanFacade
import com.trippilot.itinerarygeneration.api.ItineraryRef
import com.trippilot.itinerarygeneration.api.PlannedPlaceView
import com.trippilot.itinerarygeneration.api.PlannedSlotView
import com.trippilot.placedata.api.FrozenPoiView
import com.trippilot.placedata.api.PoiSurfaceFacade
import com.trippilot.placedata.api.PoiSurfaceView
import com.trippilot.weathercontext.api.ContextFacade
import com.trippilot.weathercontext.api.WeatherReading
import org.springframework.transaction.PlatformTransactionManager
import org.springframework.transaction.TransactionDefinition
import org.springframework.transaction.TransactionStatus
import org.springframework.transaction.support.SimpleTransactionStatus
import java.time.Instant
import java.time.LocalDate
import java.time.LocalTime
import java.util.UUID

/**
 * 실 어댑터와 **같은 규칙**의 인메모리 대역. DB 가 보장하는 것(부분 유니크·CASCADE·CHECK·잠금)은 여기서 재지 않는다 —
 * 그건 `AssistantApiIT`·`AssistantTurnIT` 가 실 DB 로 잰다.
 */
internal class FakeSessions : AssistantSessionRepository {
    val rows = mutableListOf<AssistantSession>()
    override fun openOrGet(candidate: AssistantSession) =
        rows.firstOrNull { it.accountId == candidate.accountId && it.tripId == candidate.tripId } ?: candidate.also { rows += it }
    override fun findOwned(accountId: UUID, sessionId: UUID, now: Instant) =
        rows.firstOrNull { it.sessionId == sessionId && it.accountId == accountId && it.expiresAt > now }
    override fun findByAccount(accountId: UUID, now: Instant, limit: Int) =
        rows.filter { it.accountId == accountId && it.expiresAt > now }.sortedByDescending { it.lastTurnAt }.take(limit)
    override fun recordTurn(sessionId: UUID, at: Instant, expiresAt: Instant, dialogueContext: String, refusalStreak: Int) {
        rows.replaceAll {
            if (it.sessionId == sessionId) it.copy(lastTurnAt = at, expiresAt = expiresAt, dialogueContext = dialogueContext, refusalStreak = refusalStreak) else it
        }
    }
    override fun delete(accountId: UUID, sessionId: UUID): Int = remove { it.sessionId == sessionId && it.accountId == accountId }
    override fun deleteByTrip(tripId: UUID): Int = remove { it.tripId == tripId }
    override fun deleteByAccount(accountId: UUID): Int = remove { it.accountId == accountId }
    override fun deleteExpired(now: Instant): Int = remove { it.expiresAt <= now }
    private fun remove(match: (AssistantSession) -> Boolean): Int {
        val before = rows.size
        rows.removeAll(match)
        return before - rows.size
    }
}

internal class FakeProposals : AssistantProposalRepository {
    val rows = mutableMapOf<UUID, AssistantProposal>()

    override fun create(sessionId: UUID, accountId: UUID, proposal: NewProposal, at: Instant): UUID = UUID.randomUUID().also { id ->
        rows[id] = AssistantProposal(
            id, sessionId, accountId, proposal.tripId, proposal.baseFingerprint, proposal.after, proposal.diff, proposal.violations,
            proposal.applyHint, ProposalStatus.PROPOSED, proposal.expiresAt, claimed = false,
        )
    }

    override fun findOwnedForUpdate(accountId: UUID, proposalId: UUID) = rows[proposalId]?.takeIf { it.accountId == accountId }
    override fun find(proposalId: UUID) = rows[proposalId]

    override fun claim(proposalId: UUID, at: Instant): Boolean {
        val row = rows[proposalId]?.takeIf { it.status == ProposalStatus.PROPOSED && !it.claimed } ?: return false
        rows[proposalId] = row.copy(claimed = true)
        return true
    }

    override fun close(proposalId: UUID, to: ProposalStatus, claimed: Boolean): Boolean {
        val row = rows[proposalId]?.takeIf { it.status == ProposalStatus.PROPOSED && it.claimed == claimed } ?: return false
        rows[proposalId] = row.copy(status = to)
        return true
    }
}

/**
 * 일정 쪽 변경 퍼사드 셋의 대역 — 제안·후보·저장. **저장이 몇 번 불렸는지**([edits])가 "단독 확정 없음"(PBT-U8-1)과
 * "많아야 한 번"(PBT-U8-6)의 증거다. 기본 답은 실 대역(fake 에이전트)처럼 발화를 못 알아듣는 것이다.
 */
internal class FakeEditing : ItineraryEditProposalFacade, SlotCandidateFacade, ItineraryEditFacade {
    var proposal: () -> EditProposal = { EditProposal.NotUnderstood }
    var candidates: () -> SlotCandidatesView = { SlotCandidatesView(emptyList(), degraded = false, emptyReason = "NO_NEARBY") }
    var save: () -> ItineraryEditResult = { ItineraryEditResult(UUID.randomUUID(), hasViolation = false, judged = true) }

    data class Proposal(val date: LocalDate, val request: EditProposalRequest, val deadlineMs: Long)
    data class Edit(val days: List<EditDayCommand>, val reason: String?, val source: ItineraryEditSource)

    val proposed = mutableListOf<Proposal>()
    val asked = mutableListOf<String>()
    val edits = mutableListOf<Edit>()

    /** 저장 직전에 다시 읽은 일정 — null 이면 호출측의 조건(`onlyIf`)을 묻지 않는다(그 사이 바뀐 것이 없다). */
    var currentAtSave: List<EditDayCommand>? = null

    override fun propose(accountId: UUID, tripId: UUID, targetDate: LocalDate, request: EditProposalRequest, deadlineMs: Long): EditProposal {
        proposed += Proposal(targetDate, request, deadlineMs)
        return proposal()
    }

    override fun propose(accountId: UUID, tripId: UUID, slotKey: String): SlotCandidatesView {
        asked += slotKey
        return candidates()
    }

    override fun edit(
        accountId: UUID, tripId: UUID, days: List<EditDayCommand>, reason: String?, source: ItineraryEditSource,
        onlyIf: ((current: List<EditDayCommand>) -> Boolean)?,
    ): ItineraryEditResult {
        // 실물처럼 — 조건이 거짓이면 아무것도 쓰지 않는다.
        currentAtSave?.let { current -> if (onlyIf != null && !onlyIf(current)) throw ConflictDetected(errorCode = ErrorCode.STALE) }
        edits += Edit(days, reason, source)
        return save()
    }
}

internal fun dispatcher(data: FakeTripData, editing: FakeEditing = FakeEditing(), properties: AssistantProperties = AssistantProperties()) =
    IntentDispatcher(QueryCards(data, data, data, data), ProposalCards(editing, editing, data, data, properties))

internal fun proposedSlot(poiId: UUID, start: String, distance: String? = null) =
    ProposedSlot(poiId, LocalTime.parse(start), LocalTime.parse(start).plusHours(1), isFixed = false, endsNextDay = false, distanceRange = distance)

internal fun surface(poiId: UUID, name: String) = PoiSurfaceView(poiId, name, 35.1, 129.0, "카페", "CAFE", null, null, emptyList())

internal class FakeMessages(val proposals: FakeProposals = FakeProposals()) : AssistantMessageRepository {
    /** 저장된 행 — 화면에 안 나가는 칸(계정·턴 id·관측 칸)까지 본다. */
    data class Row(
        val sessionId: UUID, val accountId: UUID, val clientTurnId: UUID?, val saved: NewMessage, val message: AssistantMessage,
        val replyTo: UUID? = null,
    )

    val rows = mutableListOf<Row>()
    private var seq = 0L

    /** 남은 평가 — 메시지 id 마다 하나(실물의 PK). 읽을 때 메시지에 붙인다(실물의 부분 질의와 같다). */
    val feedback = mutableMapOf<UUID, FeedbackRating>()

    private fun AssistantMessage.withFeedback() = copy(feedback = this@FakeMessages.feedback[messageId])

    /** 읽기 테스트용 — 이미 만들어진 메시지를 그대로 심는다. */
    fun seed(sessionId: UUID, vararg messages: AssistantMessage) {
        messages.forEach { rows += Row(sessionId, UUID.randomUUID(), null, NewMessage(it.role, it.kind, it.text), it) }
        seq = maxOf(seq, messages.maxOfOrNull { it.seq } ?: 0L)
    }

    override fun appendUser(sessionId: UUID, accountId: UUID, clientTurnId: UUID, message: NewMessage, at: Instant): AssistantMessage {
        check(rows.none { it.sessionId == sessionId && it.clientTurnId == clientTurnId }) { "같은 턴 id 의 두 번째 행 — DB 는 유니크로 거부한다" }
        return insert(sessionId, accountId, clientTurnId, null, message, at)
    }

    override fun appendAssistant(sessionId: UUID, accountId: UUID, replyTo: UUID, message: NewMessage, at: Instant): AssistantMessage {
        check(message.nextActions.isNotEmpty()) { "다음 행동 없는 도우미 메시지 — DB 는 CHECK 로 거부한다(INV-U8-03)" }
        return insert(sessionId, accountId, null, replyTo, message, at, message.proposal?.let { proposals.create(sessionId, accountId, it, at) })
    }

    override fun appendNote(sessionId: UUID, accountId: UUID, proposalId: UUID, message: NewMessage, at: Instant): AssistantMessage {
        check(message.nextActions.isNotEmpty()) { "다음 행동 없는 도우미 메시지 — DB 는 CHECK 로 거부한다(INV-U8-03)" }
        return insert(sessionId, accountId, null, null, message, at, proposalId)
    }

    private fun insert(
        sessionId: UUID, accountId: UUID, clientTurnId: UUID?, replyTo: UUID?, m: NewMessage, at: Instant, proposalId: UUID? = null,
    ): AssistantMessage {
        val stored = AssistantMessage(
            UUID.randomUUID(), ++seq, m.role, m.kind, m.text, m.payload, m.nextActions, m.quickReplies, m.footnote, at,
            proposalId?.let { proposals.rows.getValue(it).view(at) },
        )
        rows += Row(sessionId, accountId, clientTurnId, m, stored, replyTo)
        return stored
    }

    override fun findTurn(sessionId: UUID, clientTurnId: UUID): RecordedTurn? {
        val inSession = rows.filter { it.sessionId == sessionId }.sortedBy { it.message.seq }
        val user = inSession.firstOrNull { it.clientTurnId == clientTurnId } ?: return null
        return RecordedTurn(user.message.withFeedback(), inSession.filter { it.replyTo == clientTurnId }.map { it.message.withFeedback() }, user.saved.outcome)
    }

    override fun userTurnTimesSince(accountId: UUID, since: Instant) =
        rows.filter { it.accountId == accountId && it.message.role == MessageRole.USER && it.message.createdAt > since }
            .map { it.message.createdAt }.sorted()

    override fun findIssuedQuickReply(sessionId: UUID, quickReplyId: String): QuickReply? =
        rows.filter { it.sessionId == sessionId && it.message.role == MessageRole.ASSISTANT }.sortedByDescending { it.message.seq }
            .firstNotNullOfOrNull { row -> row.message.quickReplies?.firstOrNull { it.id == quickReplyId } }

    override fun lastUserText(sessionId: UUID, beforeSeq: Long): String? =
        rows.filter { it.sessionId == sessionId && it.message.role == MessageRole.USER && it.message.seq < beforeSeq }
            .filter { !it.saved.redacted && it.message.text != null && it.saved.intent == null }
            .maxByOrNull { it.message.seq }?.message?.text

    override fun findPage(sessionId: UUID, beforeSeq: Long?, limit: Int) =
        rows.filter { it.sessionId == sessionId }.map { it.message.withFeedback() }.filter { beforeSeq == null || it.seq < beforeSeq }.sortedBy { it.seq }.takeLast(limit)

    override fun findFeedbackTarget(sessionId: UUID, messageId: UUID): FeedbackTarget? =
        rows.firstOrNull { it.sessionId == sessionId && it.message.messageId == messageId }
            ?.let { FeedbackTarget(it.message.role, it.message.kind, it.saved.intent, it.saved.traceId) }

    override fun upsertFeedback(messageId: UUID, accountId: UUID, rating: FeedbackRating, at: Instant) {
        feedback[messageId] = rating
    }

    override fun deleteFeedback(messageId: UUID): Int = if (feedback.remove(messageId) != null) 1 else 0
}

internal class FakeUsage : AssistantUsageRepository {
    val turns = mutableMapOf<Pair<UUID, LocalDate>, Int>()
    val llm = mutableMapOf<Pair<UUID, LocalDate>, Int>()
    override fun llmTurns(accountId: UUID, day: LocalDate) = llm[accountId to day] ?: 0
    override fun record(accountId: UUID, day: LocalDate, llm: Boolean, turn: Boolean) {
        if (turn) turns.merge(accountId to day, 1, Int::plus)
        if (llm) this.llm.merge(accountId to day, 1, Int::plus)
    }
    override fun llmTurnsSince(from: LocalDate) = llm.filterKeys { it.second >= from }.values.sum().toLong()
    override fun deleteBefore(before: LocalDate) = (turns.keys + llm.keys).filter { it.second < before }.toSet().onEach { turns.remove(it); llm.remove(it) }.size
    override fun deleteByAccount(accountId: UUID) = (turns.keys + llm.keys).filter { it.first == accountId }.toSet().onEach { turns.remove(it); llm.remove(it) }.size
}

internal val NOOP_TX = object : PlatformTransactionManager {
    override fun getTransaction(definition: TransactionDefinition?): TransactionStatus = SimpleTransactionStatus()
    override fun commit(status: TransactionStatus) {}
    override fun rollback(status: TransactionStatus) {}
}

/** 일정·장소·날씨 읽기 대역 — **계정으로 소유를 가른다**(실 퍼사드가 그렇다). 남의 계정으로 물으면 없는 것이다. */
internal class FakeTripData(
    private val owner: UUID,
    var slots: List<PlannedSlotView> = emptyList(),
    var hasItinerary: Boolean = true,
    var surfaces: Map<UUID, PoiSurfaceView> = emptyMap(),
    var reading: WeatherReading? = null,
    var generationState: String = "COMPLETE",
    var status: String = "PLANNED",
) : ItineraryFacade, ItineraryPlanFacade, PoiSurfaceFacade, ContextFacade {
    var failItinerary = false
    var failPlan = false
    var failWeather = false

    override fun findCurrent(accountId: UUID, tripId: UUID): ItineraryRef? {
        check(!failItinerary) { "itinerary down" }
        return if (accountId == owner && hasItinerary) {
            ItineraryRef(UUID.randomUUID(), status, generationState, slots.map { it.date }.distinct(), slots.map { it.slotKey })
        } else {
            null
        }
    }

    override fun findPlanSlots(accountId: UUID, tripId: UUID): List<PlannedSlotView> {
        check(!failPlan) { "plan down" }
        return if (accountId == owner && hasItinerary) slots else emptyList()
    }

    override fun findPlannedPlaces(accountId: UUID, tripId: UUID) = emptyMap<LocalDate, List<PlannedPlaceView>>()
    override fun findSurfaces(poiIds: Collection<UUID>) = surfaces.filterKeys { it in poiIds }
    override fun findFrozenSurfaces(poiSnapshotIds: Collection<UUID>) = emptyMap<UUID, FrozenPoiView>()
    override fun precipProbabilityForTrigger(gridKey: String, at: Instant): Int? = null
    override fun readingForDisplay(gridKey: String, at: Instant): WeatherReading? {
        check(!failWeather) { "weather down" }
        return reading
    }
}

internal fun plannedSlot(
    date: LocalDate, order: Int, start: String, name: String?,
    violation: String? = null, distance: String? = null, hasViolation: Boolean = violation != null, poiId: UUID = UUID.randomUUID(),
) = PlannedSlotView(
    slotKey = "$date#$poiId", date = date, poiId = poiId, orderIndex = order,
    startAt = LocalTime.parse(start), endAt = LocalTime.parse(start).plusHours(1), isFixed = false, endsNextDay = false,
    hasViolation = hasViolation, nameKo = name, category = "카페", violationReason = violation, distanceRange = distance,
)

/**
 * 상대 세션 메모리 경계의 대역 — 무엇을 지우라고 했는지([deleted])와 내보내기를 물었는지([exported])를 적는다.
 * [fail] 이면 실 클라이언트처럼 예외로 올린다(5xx·불통).
 */
internal class FakeDialogueMemory(var items: List<MemoryItem> = emptyList()) : DialogueMemoryPort {
    val deleted = mutableListOf<String>()
    val exported = mutableListOf<String>()
    var fail = false

    override fun deleteBySession(sessionId: UUID) = record("session:$sessionId")
    override fun deleteByTrip(tripId: UUID) = record("trip:$tripId")
    override fun deleteByAccount(accountRef: String) = record("account:$accountRef")
    override fun export(accountRef: String): List<MemoryItem> {
        if (fail) throw IllegalStateException("memory down")
        exported += accountRef
        return items
    }

    private fun record(key: String): Int {
        if (fail) throw IllegalStateException("memory down")
        deleted += key
        return 1
    }
}

/** 발행한 이벤트를 적는다 — 아웃박스 적재 대역. */
internal class CapturingEvents : com.trippilot.core.event.DomainEventPublisher {
    val published = mutableListOf<com.trippilot.core.event.DomainEvent>()
    override fun publish(event: com.trippilot.core.event.DomainEvent) { published += event }
}
