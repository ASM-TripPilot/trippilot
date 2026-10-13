package com.trippilot.assistant.application

import com.fasterxml.jackson.databind.ObjectMapper
import com.fasterxml.jackson.databind.node.ObjectNode
import com.trippilot.assistant.domain.AccountTurnLock
import com.trippilot.assistant.domain.AssistantMessage
import com.trippilot.assistant.domain.AssistantMessageRepository
import com.trippilot.assistant.domain.AssistantSession
import com.trippilot.assistant.domain.AssistantSessionRepository
import com.trippilot.assistant.domain.AssistantSurface
import com.trippilot.assistant.domain.AssistantUsageRepository
import com.trippilot.assistant.domain.DialogueInterpretPort
import com.trippilot.assistant.domain.Intent
import com.trippilot.assistant.domain.InterpretOutcome
import com.trippilot.assistant.domain.InterpretRequest
import com.trippilot.assistant.domain.Interpretation
import com.trippilot.assistant.domain.MessageKind
import com.trippilot.assistant.domain.MessageRole
import com.trippilot.assistant.domain.NewMessage
import com.trippilot.assistant.domain.QuickReply
import com.trippilot.assistant.domain.QuickReplyAction
import com.trippilot.assistant.domain.RecordedTurn
import com.trippilot.core.error.FieldError
import com.trippilot.core.error.RateLimited
import com.trippilot.core.error.ResourceNotFound
import com.trippilot.core.error.ValidationFailed
import com.trippilot.moderation.api.TextModerationFacade
import org.slf4j.LoggerFactory
import org.springframework.beans.factory.ObjectProvider
import org.springframework.stereotype.Service
import org.springframework.transaction.PlatformTransactionManager
import org.springframework.transaction.support.TransactionTemplate
import java.time.Clock
import java.time.Duration
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.util.UUID

/** 한 턴의 입력 — 발화이거나, 서버가 발급한 빠른 답을 누른 것이다. */
sealed interface TurnInput {
    data class Text(val text: String) : TurnInput
    data class Action(val quickReplyId: String) : TurnInput
}

/** @property quickReplies 입력창 위에 보일 빠른 답 — 마지막 도우미 메시지가 정했으면 그것, 아니면 대화의 시작 빠른 답. */
data class TurnResult(val messages: List<AssistantMessage>, val quickReplies: List<QuickReply>)

/**
 * 한 턴(FD §2). 발화를 받아 사용자 메시지 1건과 도우미 메시지 1건 이상으로 답한다.
 *
 * ## 트랜잭션이 셋이다(PERF-U8-06)
 *
 * 1. 소유·멱등·분당 제한·입력 검사·사용자 행 → **커밋**
 * 2. 해석(상대 호출) — **트랜잭션 밖**
 * 3. 도우미 행·세션·사용량 → 커밋
 *
 * 하나로 묶으면 상대를 기다리는 동안 DB 연결을 쥔다 — 동시에 열 턴이면 다른 모든 API 가 굶는다.
 * 계정 잠금(분당 제한을 파드 수와 무관하게 정확히 세는 장치, SEC-U8-01)도 1 에서만 걸려 상대를 부르기 전에 풀린다.
 *
 * ## 2 에서 무엇이 잘못돼도 턴은 도우미 메시지 한 건으로 끝난다(BR-U8-40)
 *
 * 사용자 행은 1 에서 이미 남았다. 해석 실패·시한 초과·입력 검사 불가는 전부 폴백 메시지다 — 빈 응답도 재시도도 없다.
 * **이 경로의 어떤 실패도 일정을 건드리지 않는다**(BR-U8-45).
 *
 * 로그에 발화 원문을 싣지 않는다(SEC-U8-06) — 세션 id·길이·결과만.
 */
@Service
class AssistantTurnService(
    private val sessions: AssistantSessionRepository,
    private val messages: AssistantMessageRepository,
    private val usage: AssistantUsageRepository,
    private val lock: AccountTurnLock,
    private val moderation: TextModerationFacade,
    private val interpreter: ObjectProvider<DialogueInterpretPort>,
    private val dispatcher: IntentDispatcher,
    private val tripContexts: TripContextReader,
    private val properties: AssistantProperties,
    private val mapper: ObjectMapper,
    private val clock: Clock,
    transactionManager: PlatformTransactionManager,
) {
    private val tx = TransactionTemplate(transactionManager)

    fun send(accountId: UUID, sessionId: UUID, clientTurnId: UUID, input: TurnInput, surface: AssistantSurface): TurnResult {
        val startedAt = clock.instant()
        val accepted = tx.execute { accept(accountId, sessionId, clientTurnId, input, startedAt) }!!
        if (accepted is Accepted.Replay) return accepted.result

        accepted as Accepted.New
        val reply = runCatching { respond(accepted, surface, startedAt) }.getOrElse { e ->
            // 처리기·조회의 예상 못 한 실패도 턴을 죽이지 않는다 — 사용자 행은 이미 남았다.
            log.warn("도우미 턴 처리 실패 — 폴백으로 답합니다. sessionId={} type={}", sessionId, e.javaClass.simpleName)
            Reply(AssistantTemplates.fallback(FallbackCause.SOURCE_UNAVAILABLE))
        }
        val finishedAt = clock.instant()
        val stored = tx.execute { finish(accepted, reply, startedAt, finishedAt) }!!
        return TurnResult(listOf(accepted.user, stored), stored.quickReplies ?: StartQuickReplies.of(accepted.session.tripId != null))
    }

    // ── 1. 받기 ────────────────────────────────────────────────────────────

    private sealed interface Accepted {
        data class Replay(val result: TurnResult) : Accepted

        /** @property utterance 해석에 태울 문장. null 이면 해석 없이 [action] 으로 답한다. */
        data class New(
            val session: AssistantSession,
            val user: AssistantMessage,
            val utterance: String?,
            val action: QuickReply?,
            val verdict: InputVerdict,
        ) : Accepted
    }

    private enum class InputVerdict { CLEAN, VIOLATION, UNCHECKED }

    private fun accept(accountId: UUID, sessionId: UUID, clientTurnId: UUID, input: TurnInput, now: Instant): Accepted {
        val session = sessions.findOwned(accountId, sessionId, now) ?: throw ResourceNotFound() // 남의 대화는 있는지도 모르게

        // 같은 턴이 다시 왔다(재전송·재시도) — 새로 만들지 않고 처음 응답을 그대로 준다(INV-U8-05).
        messages.findTurn(sessionId, clientTurnId)?.let { turn ->
            if (turn.replies.isNotEmpty()) return Accepted.Replay(turn.toResult(session))
            // 사용자 행만 남고 응답이 없다 — 지난번이 3 에서 실패했다. 사용자 행을 다시 만들지 않고 이어서 답한다.
            return resume(session, turn.user, input)
        }

        // 계정 단위로 줄을 세운 뒤 센다 — 안 세우면 동시 요청이 각자 19를 보고 21번째가 통과한다(SEC-U8-01).
        lock.acquire(accountId)
        val window = messages.userTurnTimesSince(accountId, now - WINDOW)
        if (window.size >= properties.rateLimitPerMinute) {
            // 창에서 가장 먼저 빠질 턴이 빠지는 시각까지 — 거절된 턴은 기록하지 않는다(BR-U8-24).
            val frees = window[window.size - properties.rateLimitPerMinute] + WINDOW
            throw RateLimited(retryAfterSeconds = Duration.between(now, frees).seconds.coerceAtLeast(1))
        }

        return when (input) {
            is TurnInput.Text -> {
                if (input.text.isBlank() || input.text.length > MAX_UTTERANCE_LENGTH) {
                    throw ValidationFailed(listOf(FieldError("input.text", "1~${MAX_UTTERANCE_LENGTH}자여야 합니다.")))
                }
                // 상대를 부르기 **전에** 검사한다(BR-U8-23). 위반 원문은 저장하지 않는다 — 계정 기록에 쌓을 이유가 없다.
                // 사전이 없어 검사를 못 했으면 통과가 아니다(fail-closed): 확인 못 한 문장도 저장하지 않는다.
                val verdict = runCatching { if (moderation.inspect(input.text).clean) InputVerdict.CLEAN else InputVerdict.VIOLATION }
                    .getOrElse {
                        log.warn("도우미 입력 검사를 할 수 없습니다 — 통과시키지 않습니다. sessionId={}", sessionId)
                        InputVerdict.UNCHECKED
                    }
                val clean = verdict == InputVerdict.CLEAN
                val user = messages.appendUser(
                    sessionId, accountId, clientTurnId,
                    NewMessage(MessageRole.USER, MessageKind.TEXT, text = input.text.takeIf { clean }, redacted = !clean), now,
                )
                Accepted.New(session, user, utterance = input.text.takeIf { clean }, action = null, verdict = verdict)
            }
            is TurnInput.Action -> {
                val pressed = issued(session, input.quickReplyId)
                // 무엇을 눌렀는지를 행에 남긴다 — [다시 시도]가 "다시 태울 말"을 고를 때 이 행들을 건너뛴다.
                val user = messages.appendUser(
                    sessionId, accountId, clientTurnId,
                    NewMessage(MessageRole.USER, MessageKind.TEXT, text = pressed.label, matchRoute = "ACTION", intent = pressed.action), now,
                )
                Accepted.New(session, user, utterance = null, action = pressed, verdict = InputVerdict.CLEAN)
            }
        }
    }

    /** 서버가 발급한 빠른 답만 받는다 — 앱이 지어낸 id 로 서버 동작을 고르게 두지 않는다. */
    private fun issued(session: AssistantSession, quickReplyId: String): QuickReply =
        StartQuickReplies.find(quickReplyId)
            ?: messages.findIssuedQuickReply(session.sessionId, quickReplyId)
            ?: throw ValidationFailed(listOf(FieldError("input.quickReplyId", "발급된 적 없는 빠른 답입니다.")))

    private fun resume(session: AssistantSession, user: AssistantMessage, input: TurnInput): Accepted.New = when (input) {
        // 저장된 행이 가려져 있으면(위반·검사 불가) 원문으로 다시 해석하지 않는다 — 처음 판정을 따른다.
        is TurnInput.Text -> Accepted.New(session, user, utterance = user.text, action = null,
            verdict = if (user.text == null) InputVerdict.VIOLATION else InputVerdict.CLEAN)
        is TurnInput.Action -> Accepted.New(session, user, null, issued(session, input.quickReplyId), InputVerdict.CLEAN)
    }

    private fun RecordedTurn.toResult(session: AssistantSession) =
        TurnResult(listOf(user) + replies, replies.last().quickReplies ?: StartQuickReplies.of(session.tripId != null))

    // ── 2. 답하기(트랜잭션 밖) ────────────────────────────────────────────

    /** @property dialogueContext 해석이 돌려준 맥락. null 이면 맥락은 그대로다. */
    private data class Reply(
        val message: NewMessage,
        val dialogueContext: String? = null,
        val refused: Boolean = false,
        val llm: Boolean = false,
    )

    private fun respond(turn: Accepted.New, surface: AssistantSurface, startedAt: Instant): Reply {
        val session = turn.session
        val hasTrip = session.tripId != null
        when (turn.verdict) {
            InputVerdict.VIOLATION -> return refuse(session, AssistantTemplates.refusal(null))
            InputVerdict.UNCHECKED -> return Reply(AssistantTemplates.fallback(FallbackCause.SOURCE_UNAVAILABLE))
            InputVerdict.CLEAN -> Unit
        }

        // 빠른 답 — 해석을 건너뛴다(LLM 0회, COST-U8-07). 말로 다시 태워야 하는 것만 아래 해석으로 내려간다.
        val utterance = turn.utterance ?: when (turn.action?.action) {
            QuickReplyAction.SEND_TEXT.name, QuickReplyAction.PICK_OPTION.name -> turn.action.label
            // [다시 시도] — 직전에 못 알아들은 그 말을 다시 태운다. 다시 태울 말이 없으면 할 수 있는 것을 보인다.
            QuickReplyAction.RETRY.name -> messages.lastUserText(session.sessionId, beforeSeq = turn.user.seq)
                ?: return Reply(AssistantTemplates.capabilities(hasTrip))
            QuickReplyAction.REVIEW.name -> return dispatched(Intent.SHOW_SCHEDULE, null, session, surface)
            // 후보 고르기는 제안 카드와 함께 들어온다(TRIP-1379) — 그때까지는 편집 화면으로 넘긴다.
            QuickReplyAction.PICK_CANDIDATE.name -> return dispatched(Intent.EDIT_SCHEDULE, null, session, surface)
            else -> return Reply(AssistantTemplates.capabilities(hasTrip))
        }

        // 해석을 쓰지 않는 상태 — 막지 않고 버튼으로 낮춘다(COST-U8-03 · REL-U8-06). 조용히 낮추지 않는다(OBS-U8-03).
        val port = interpreter.ifAvailable
        val overDailyLimit = port != null && usage.llmTurns(session.accountId, today(startedAt)) >= properties.dailyLlmTurnLimit
        if (port == null || overDailyLimit) {
            log.warn("도우미 강등 — 버튼 모드로 답합니다. reason={} account={}", if (port == null) "INTERPRET_OFF" else "DAILY_LLM_LIMIT", session.accountId.hashCode())
            return Reply(AssistantTemplates.buttonMode(hasTrip))
        }

        // 남은 예산 안에서만 부른다 — 모자라면 부르지 않는다(PERF-U8-02).
        val remaining = properties.turnBudgetMs - Duration.between(startedAt, clock.instant()).toMillis()
        if (remaining < MIN_INTERPRET_BUDGET_MS) return Reply(AssistantTemplates.fallback(FallbackCause.AI_UNAVAILABLE))
        val interpretation = runCatching {
            port.interpret(
                InterpretRequest(
                    utterance = utterance, surface = surface,
                    dialogueContext = bumpTurnIndex(session.dialogueContext),
                    requestedAt = startedAt, deadlineMs = minOf(properties.interpretStageMaxMs, remaining),
                ),
            )
        }.getOrElse { e ->
            log.warn("도우미 해석 실패 — 폴백으로 답합니다. sessionId={} type={}", session.sessionId, e.javaClass.simpleName)
            return Reply(AssistantTemplates.fallback(FallbackCause.AI_UNAVAILABLE))
        }
        return answer(interpretation, session, surface)
    }

    private fun answer(result: Interpretation, session: AssistantSession, surface: AssistantSurface): Reply {
        val hasTrip = session.tripId != null
        val llm = result.llmCalls >= 1
        fun reply(message: NewMessage, refused: Boolean = false) = Reply(
            message.copy(llmCalls = result.llmCalls, matchRoute = result.frames.firstOrNull()?.matchRoute ?: message.matchRoute),
            dialogueContext = result.dialogueContext, refused = refused, llm = llm,
        )
        if (result.outcome == InterpretOutcome.OUT_OF_SCOPE) {
            val refusal = refuse(session, dispatcher.dispatch(Intent.OUT_OF_SCOPE, context(session, surface)).copy(intent = Intent.OUT_OF_SCOPE.name))
            return reply(refusal.message, refused = true)
        }
        // 프레임이 하나가 아니면 실행하지 않는다(DEC-U8-11) — 여러 요청 중 하나를 골라 하면 반드시 틀린다.
        val frame = result.frames.singleOrNull() ?: return reply(AssistantTemplates.oneAtATime(hasTrip))
        return when (result.outcome) {
            InterpretOutcome.ARGUMENT_CLARIFY -> {
                // 되묻기라면서 물을 것이 없다 — 계약이 어긋났다. 지어내 묻지 않고 하나씩 말해 달라고 한다.
                val clarify = result.clarify ?: return reply(AssistantTemplates.oneAtATime(hasTrip))
                reply(AssistantTemplates.clarify(clarify.argument, clarify.question, clarify.options).copy(intent = frame.intent.name))
            }
            else -> reply(dispatched(frame.intent, frame.matchRoute, session, surface).message)
        }
    }

    private fun dispatched(intent: Intent, matchRoute: String?, session: AssistantSession, surface: AssistantSurface) =
        Reply(dispatcher.dispatch(intent, context(session, surface)).copy(intent = intent.name, matchRoute = matchRoute ?: "ACTION"))

    private fun context(session: AssistantSession, surface: AssistantSurface): DispatchContext {
        val trip = session.tripId?.let { tripContexts.read(session.accountId, it) }
        return DispatchContext(hasTrip = trip != null, inTrip = trip?.inTrip(today(clock.instant())) ?: false, surface = surface)
    }

    /** 거절이 이어지면 같은 거절을 되풀이하지 않고 쓰는 법을 안내한다(BR-U8-25). */
    private fun refuse(session: AssistantSession, message: NewMessage): Reply =
        Reply(if (session.refusalStreak + 1 >= REFUSALS_BEFORE_GUIDE) AssistantTemplates.usageGuide(session.tripId != null) else message, refused = true)

    /**
     * `turn_index` 만 하나 올린다 — 나머지는 읽지도 고치지도 않는다(INV-U8-07). 같은 규칙을 두 곳이 판정하면 갈라진다.
     * 맥락이 아직 없으면(첫 턴) 상대의 빈 직렬형으로 시작한다.
     */
    internal fun bumpTurnIndex(dialogueContext: String): String {
        val node = mapper.readTree(dialogueContext) as? ObjectNode ?: mapper.createObjectNode()
        if (node.isEmpty) {
            node.putNull("pending")
            node.put("clarify_count", 0)
        }
        node.put("turn_index", (node.get("turn_index")?.asInt() ?: 0) + 1)
        return mapper.writeValueAsString(node)
    }

    // ── 3. 남기기 ──────────────────────────────────────────────────────────

    private fun finish(turn: Accepted.New, reply: Reply, startedAt: Instant, finishedAt: Instant): AssistantMessage {
        val session = turn.session
        val stored = messages.appendAssistant(
            session.sessionId, session.accountId,
            reply.message.copy(latencyMs = Duration.between(startedAt, finishedAt).toMillis().toInt()), finishedAt,
        )
        sessions.recordTurn(
            sessionId = session.sessionId, at = finishedAt, expiresAt = finishedAt + properties.retention,
            // 해석을 안 탄 턴도 턴은 지나갔다 — 순번만 올린다. 보류 중인 되묻기의 폐기는 상대가 그 순번으로 판정한다.
            dialogueContext = reply.dialogueContext ?: bumpTurnIndex(session.dialogueContext),
            refusalStreak = if (reply.refused) session.refusalStreak + 1 else 0,
        )
        usage.record(session.accountId, today(startedAt), llm = reply.llm)
        return stored
    }

    private fun today(at: Instant): LocalDate = LocalDate.ofInstant(at, TRAVEL_ZONE)

    companion object {
        /** 상대 계약의 발화 상한과 같다(FD §3.1). */
        const val MAX_UTTERANCE_LENGTH = 500
        private val WINDOW: Duration = Duration.ofSeconds(60)
        private const val REFUSALS_BEFORE_GUIDE = 2
        private const val MIN_INTERPRET_BUDGET_MS = 1_000L
        private val TRAVEL_ZONE: ZoneId = ZoneId.of("Asia/Seoul")
        private val log = LoggerFactory.getLogger(AssistantTurnService::class.java)
    }
}
