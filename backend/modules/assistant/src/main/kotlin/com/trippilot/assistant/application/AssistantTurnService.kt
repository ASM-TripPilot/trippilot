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
import org.springframework.dao.DataIntegrityViolationException
import org.springframework.stereotype.Service
import org.springframework.transaction.PlatformTransactionManager
import org.springframework.transaction.support.TransactionTemplate
import java.time.Clock
import java.time.Duration
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap

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
 * 0. 입력 검사(길이·금칙어) — 트랜잭션 밖. 금칙어 조회가 깨져도 1 의 트랜잭션을 오염시키지 않게.
 * 1. 소유·멱등·분당 제한·사용자 행 → **커밋**
 * 2. 해석(상대 호출) — **트랜잭션 밖**
 * 3. 도우미 행·세션·사용량 → 커밋
 *
 * 하나로 묶으면 상대를 기다리는 동안 DB 연결을 쥔다 — 동시에 열 턴이면 다른 모든 API 가 굶는다.
 * 계정 잠금(분당 제한을 파드 수와 무관하게 정확히 세는 장치, SEC-U8-01)은 1 과 3 에서 각각 걸고, 상대를 부르는 동안은
 * 풀려 있다.
 *
 * ## 같은 턴이 겹쳐 들어오면 뒤쪽은 기다린다(INV-U8-05)
 *
 * 앱이 대기를 취소하고 같은 턴 id 로 다시 보내면 서버의 첫 처리는 아직 돌고 있다. 뒤쪽은 다시 해석하지 않고 앞쪽이
 * 응답을 남기기를 기다렸다가 그것을 돌려준다. 응답은 위치가 아니라 **턴 id 로** 묶인다(`reply_to`) — 서로 다른 턴이
 * 겹쳐도 각자의 답이 각자의 턴에 붙는다.
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
    private val snapshots: ContextSnapshotBuilder,
    private val properties: AssistantProperties,
    private val mapper: ObjectMapper,
    private val clock: Clock,
    transactionManager: PlatformTransactionManager,
) {
    private val tx = TransactionTemplate(transactionManager)

    fun send(accountId: UUID, sessionId: UUID, clientTurnId: UUID, input: TurnInput, surface: AssistantSurface): TurnResult {
        val startedAt = clock.instant()
        val verdict = inspect(input, sessionId)
        val accepted = when (val first = tx.execute { accept(accountId, sessionId, clientTurnId, input, verdict, startedAt) }!!) {
            is Accepted.Replay -> return first.result
            is Accepted.New -> first
            // 같은 턴이 이미 들어와 있다 — 앞선 처리가 답을 남기기를 기다린다. 못 남기고 죽었으면 넘겨받는다.
            is Accepted.Pending -> awaitAdmitted(first, sessionId, clientTurnId)?.let { return it } ?: first.resumed
        }
        val reply = runCatching { respond(accepted, surface, startedAt) }.getOrElse { e ->
            // 처리기·조회의 예상 못 한 실패도 턴을 죽이지 않는다 — 사용자 행은 이미 남았다.
            log.warn("도우미 턴 처리 실패 — 폴백으로 답합니다. sessionId={} type={}", sessionId, e.javaClass.simpleName)
            // 버튼을 눌러 온 턴에는 [다시 시도]를 주지 않는다 — 다시 태울 "말"이 없어 엉뚱한 옛 문장이 나간다.
            Reply(AssistantTemplates.fallback(FallbackCause.SOURCE_UNAVAILABLE, retryable = accepted.action == null), streak = Streak.KEEP)
        }
        val finishedAt = clock.instant()
        val replies = try {
            tx.execute { finish(accepted, clientTurnId, reply, startedAt, finishedAt) }
        } catch (e: DataIntegrityViolationException) {
            // 확인과 삽입 사이에 대화가 지워진 찰나의 경합만 "대화가 없다"다. 대화가 그대로 있으면 진짜 결함이다
            // (다음 행동 없는 응답·길이 초과 등) — 404 로 가리면 응답 없는 턴이 남아 재전송마다 다시 해석한다.
            if (tx.execute { sessions.findOwned(accountId, sessionId, finishedAt) } != null) throw e
            log.warn("도우미 응답을 남기려는데 대화가 사라졌습니다. sessionId={} type={}", sessionId, e.javaClass.simpleName)
            null
        } ?: run {
            // 답하는 사이 대화가 지워졌다(이력 지우기·여행 삭제) — 남길 곳이 없다. 500 이 아니라 "그 대화는 없다"다.
            // 그래도 **쓴 LLM 은 센다**: 안 세면 "보내고 지우기"를 되풀이해 하루 상한을 비켜 간다(사용량은 계정에 묶여 남는다).
            if (reply.llm) tx.execute { usage.record(accountId, today(startedAt), llm = true, turn = false) }
            throw ResourceNotFound()
        }
        return TurnResult(listOf(accepted.user) + replies, replies.last().quickReplies ?: StartQuickReplies.of(accepted.session.tripId != null))
    }

    /**
     * 앞선 처리가 끝나기를 기다린다 — 끝나면 그 응답을 그대로 준다(INV-U8-05). **다시 해석하지 않는다**: 같은 턴 id 를
     * 여러 번 겹쳐 보내 해석을 그 수만큼 돌리면 분당 제한(사용자 행은 하나뿐이다)과 하루 LLM 상한을 비켜 간다.
     *
     * 턴 예산(+ 왕복 여유)이 지나도록 응답이 없으면 앞선 처리는 죽은 것이다(남기기 실패·파드 종료) — null 을 돌려
     * 넘겨받게 한다. 기다리는 동안 DB 연결은 쥐지 않는다.
     *
     * 기다리는 요청은 **턴마다 [MAX_WAITERS_PER_TURN] 개까지**다 — 같은 턴 id 를 N 번 겹쳐 보내면 요청 스레드 N 개가 앞선
     * 처리가 끝날 때까지(http 해석이면 십여 초) 서서 스레드 풀을 말린다. 정상 재전송은 한두 번이라 그 안에 든다. 넘친 요청은
     * 429 — 기다려 봐야 같은 답이고, 잠시 뒤 다시 보내면 그때는 저장된 답(Replay)을 받는다.
     *
     * ponytail: 파드마다 센다(메모리). 겹친 요청이 여러 파드로 흩어지면 파드 수만큼 더 선다 — 요청 스레드를 지키는 것이
     * 목적이라 파드 단위로 충분하다.
     */
    private fun awaitAdmitted(pending: Accepted.Pending, sessionId: UUID, clientTurnId: UUID): TurnResult? {
        val key = sessionId to clientTurnId
        val admitted = waiters.merge(key, 1, Int::plus)!! <= MAX_WAITERS_PER_TURN
        try {
            if (!admitted) throw RateLimited(retryAfterSeconds = ((properties.turnBudgetMs + 999) / 1000).coerceAtLeast(1))
            return awaitFirst(pending, sessionId, clientTurnId)
        } finally {
            waiters.computeIfPresent(key) { _, n -> (n - 1).takeIf { it > 0 } }
        }
    }

    /** 턴(대화 + 턴 id)마다 지금 기다리는 요청 수. 0 이 되면 지운다 — 쌓이지 않는다. */
    private val waiters = ConcurrentHashMap<Pair<UUID, UUID>, Int>()

    /** 지금 기다리는 요청이 있는 턴 수 — 대기가 끝나면 0 으로 돌아와야 한다(세는 칸이 새면 같은 턴의 다음 대기가 막힌다). */
    internal val waitingTurns: Int get() = waiters.size

    private fun awaitFirst(pending: Accepted.Pending, sessionId: UUID, clientTurnId: UUID): TurnResult? {
        val giveUpAt = pending.resumed.user.createdAt + Duration.ofMillis(properties.turnBudgetMs + properties.readMarginMs)
        while (clock.instant() < giveUpAt) {
            pause(POLL_MS)
            val turn = tx.execute { messages.findTurn(sessionId, clientTurnId) } ?: throw ResourceNotFound() // 그 사이 대화가 지워졌다
            if (turn.replies.isNotEmpty()) return turn.toResult(pending.resumed.session)
        }
        return null
    }

    /** 기다리는 방법 — 테스트가 시계를 밀 수 있게 갈아끼운다. */
    internal var pause: (Long) -> Unit = { Thread.sleep(it) }

    // ── 0. 입력 검사(트랜잭션 밖) ──────────────────────────────────────────

    /**
     * 상대를 부르기 **전에** 검사한다(BR-U8-23). 사전이 없어 검사를 못 했으면 통과가 아니다(fail-closed).
     * 빠른 답은 서버가 발급한 문구라 검사하지 않는다.
     */
    private fun inspect(input: TurnInput, sessionId: UUID): InputVerdict {
        if (input !is TurnInput.Text) return InputVerdict.CLEAN
        // NUL 은 DB 가 받지 않는다 — 저장에서 500 이 나기 전에 입력 오류로 돌려준다.
        if (input.text.isBlank() || input.text.length > MAX_UTTERANCE_LENGTH || '\u0000' in input.text) {
            throw ValidationFailed(listOf(FieldError("input.text", "1~${MAX_UTTERANCE_LENGTH}자여야 합니다.")))
        }
        return runCatching { if (moderation.inspect(input.text).clean) InputVerdict.CLEAN else InputVerdict.VIOLATION }
            .getOrElse {
                log.warn("도우미 입력 검사를 할 수 없습니다 — 통과시키지 않습니다. sessionId={}", sessionId)
                InputVerdict.UNCHECKED
            }
    }

    // ── 1. 받기 ────────────────────────────────────────────────────────────

    private sealed interface Accepted {
        data class Replay(val result: TurnResult) : Accepted

        /** 사용자 행은 있는데 응답이 아직 없다 — 앞선 처리가 돌고 있거나 죽었다. [resumed] 는 넘겨받을 때 쓸 모양이다. */
        data class Pending(val resumed: New) : Accepted

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

    private fun accept(accountId: UUID, sessionId: UUID, clientTurnId: UUID, input: TurnInput, verdict: InputVerdict, now: Instant): Accepted {
        val session = sessions.findOwned(accountId, sessionId, now) ?: throw ResourceNotFound() // 남의 대화는 있는지도 모르게

        // 계정 단위로 줄을 세운다. 분당 제한이 정확해지고(안 세우면 동시 요청이 각자 19를 보고 21번째가 통과한다, SEC-U8-01),
        // 같은 턴 id 가 동시에 둘 들어와도 뒤쪽은 앞쪽이 남긴 사용자 행을 본다(유니크 위반 500 이 아니다).
        lock.acquire(accountId)

        // 같은 턴이 다시 왔다(재전송·재시도) — 새로 만들지 않고 처음 응답을 그대로 준다(INV-U8-05).
        messages.findTurn(sessionId, clientTurnId)?.let { turn ->
            if (turn.replies.isNotEmpty()) return Accepted.Replay(turn.toResult(session))
            // 사용자 행만 있고 응답이 없다 — 첫 처리가 아직 2 에 있거나, 지난번이 3 에서 실패했다.
            // 어느 쪽이든 사용자 행을 다시 만들지 않는다. 어느 쪽인지는 밖에서 기다려 보고 가른다.
            return Accepted.Pending(resume(session, turn, input))
        }

        val window = messages.userTurnTimesSince(accountId, now - WINDOW)
        if (window.size >= properties.rateLimitPerMinute) {
            // 창에서 가장 먼저 빠질 턴이 빠지는 시각까지(올림 — 내림하면 그 초에 다시 보낸 요청이 또 429 다).
            // 거절된 턴은 기록하지 않는다(BR-U8-24).
            val frees = window[window.size - properties.rateLimitPerMinute] + WINDOW
            throw RateLimited(retryAfterSeconds = ((Duration.between(now, frees).toMillis() + 999) / 1000).coerceAtLeast(1))
        }

        return when (input) {
            is TurnInput.Text -> {
                // 위반 원문은 저장하지 않는다 — 계정 기록에 쌓을 이유가 없다. 확인 못 한 문장도 같다.
                val clean = verdict == InputVerdict.CLEAN
                val user = messages.appendUser(
                    sessionId, accountId, clientTurnId,
                    // 왜 가려졌는지를 행에 남긴다 — 이 턴을 넘겨받는 요청이 "위반"과 "검사 못 함"을 다시 가를 수 있게.
                    NewMessage(MessageRole.USER, MessageKind.TEXT, text = input.text.takeIf { clean }, redacted = !clean, outcome = verdict.name.takeIf { !clean }), now,
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

    private fun resume(session: AssistantSession, turn: RecordedTurn, input: TurnInput): Accepted.New = when (input) {
        // **저장된 행의 판정을 따른다** — 이번 요청의 원문으로 다시 판정하지 않는다(그 사이 사전이 바뀌어도 처음 그대로).
        is TurnInput.Text -> Accepted.New(
            session, turn.user, utterance = turn.user.text, action = null,
            verdict = when {
                turn.user.text != null -> InputVerdict.CLEAN
                turn.redaction == InputVerdict.UNCHECKED.name -> InputVerdict.UNCHECKED
                else -> InputVerdict.VIOLATION
            },
        )
        is TurnInput.Action -> Accepted.New(session, turn.user, null, issued(session, input.quickReplyId), InputVerdict.CLEAN)
    }

    private fun RecordedTurn.toResult(session: AssistantSession) =
        TurnResult(listOf(user) + replies, replies.last().quickReplies ?: StartQuickReplies.of(session.tripId != null))

    // ── 2. 답하기(트랜잭션 밖) ────────────────────────────────────────────

    /** 연속 거절 수를 어떻게 할 것인가(BR-U8-25) — 거절이면 올리고, 정상 턴이면 0, 폴백·강등은 건드리지 않는다. */
    private enum class Streak { REFUSED, NORMAL, KEEP }

    /** @property dialogueContext 해석이 돌려준 맥락. null 이면 맥락은 그대로다. */
    private data class Reply(
        val message: NewMessage,
        val dialogueContext: String? = null,
        val streak: Streak = Streak.NORMAL,
        val llm: Boolean = false,
    )

    private fun respond(turn: Accepted.New, surface: AssistantSurface, startedAt: Instant): Reply {
        val session = turn.session
        val hasTrip = session.tripId != null
        when (turn.verdict) {
            InputVerdict.VIOLATION -> return refuse(session, AssistantTemplates.refusal(null))
            // 그 문장은 저장하지 않았다 — [다시 시도]를 주면 다시 태울 것이 엉뚱한 옛 문장이다.
            InputVerdict.UNCHECKED ->
                return Reply(AssistantTemplates.fallback(FallbackCause.SOURCE_UNAVAILABLE, retryable = false), streak = Streak.KEEP)
            InputVerdict.CLEAN -> Unit
        }

        // 빠른 답 — **해석을 건너뛴다**(LLM 0회, COST-U8-07 · FD §3.1). 그래서 해석이 꺼진 버튼 모드에서도 그대로 된다.
        // 말로 다시 태워야만 하는 둘(되묻기의 보기 · 다시 시도)만 아래 해석으로 내려간다.
        val utterance = turn.utterance ?: run {
            val pressed = turn.action ?: return Reply(AssistantTemplates.capabilities(hasTrip))
            pressed.params[StartQuickReplies.INTENT]?.let { name ->
                val intent = runCatching { Intent.valueOf(name) }.getOrNull() ?: return Reply(AssistantTemplates.capabilities(hasTrip))
                // 버튼이 실어 온 나머지 값(어느 슬롯인가 등)은 서버가 발급한 것이라 그대로 인자로 쓴다.
                return dispatched(intent, null, session, surface, startedAt, pressed.params - StartQuickReplies.INTENT)
            }
            if (pressed.params[StartQuickReplies.OPEN] == "OPEN_STAY_SEARCH") return Reply(AssistantTemplates.staySearch())
            when (pressed.action) {
                QuickReplyAction.REVIEW.name -> return dispatched(Intent.SHOW_SCHEDULE, null, session, surface, startedAt)
                // 후보를 골랐다 — 그 슬롯을 그 장소로 바꾼 **제안**을 낸다(LLM 0회). 저장은 [적용]을 눌러야 한다.
                QuickReplyAction.PICK_CANDIDATE.name -> return dispatched(Intent.EDIT_SCHEDULE, null, session, surface, startedAt, pressed.params)
                QuickReplyAction.SEND_TEXT.name, QuickReplyAction.PICK_OPTION.name -> pressed.label
                // [다시 시도] — 직전에 못 알아들은 그 말을 다시 태운다. 다시 태울 말이 없으면 할 수 있는 것을 보인다.
                QuickReplyAction.RETRY.name -> messages.lastUserText(session.sessionId, beforeSeq = turn.user.seq)
                    ?: return Reply(AssistantTemplates.capabilities(hasTrip))
                else -> return Reply(AssistantTemplates.capabilities(hasTrip))
            }
        }

        // 해석을 쓰지 않는 상태 — 막지 않고 버튼으로 낮춘다(COST-U8-03 · REL-U8-06).
        val port = interpreter.ifAvailable ?: return Reply(AssistantTemplates.buttonMode(hasTrip), streak = Streak.KEEP)
        if (usage.llmTurns(session.accountId, today(startedAt)) >= properties.dailyLlmTurnLimit) {
            // 조용히 낮추지 않는다(OBS-U8-03). 꺼진 모드는 상태라 기동 때 한 번 알리고, 상한 도달은 사건이라 여기서 남긴다.
            log.warn("도우미 강등 — 하루 LLM 턴 상한에 닿아 버튼 모드로 답합니다. account={}", session.accountId.hashCode())
            return Reply(AssistantTemplates.buttonMode(hasTrip), streak = Streak.KEEP)
        }
        // 서비스 전역 월 상한(COST-U8-04) — 계정이 아니라 **전체**가 낮아진다. 달이 바뀌면 저절로 풀린다. 0 이면 꺼져 있다.
        // ponytail: 턴마다 이번 달 합계를 센다(40일치 카운터 테이블이라 작다). 느려지면 분 단위로 기억해 둔다.
        if (properties.monthlyLlmCallLimit > 0 && usage.llmTurnsSince(today(startedAt).withDayOfMonth(1)) >= properties.monthlyLlmCallLimit) {
            log.warn("도우미 강등 — 이번 달 전역 LLM 상한({})에 닿아 버튼 모드로 답합니다.", properties.monthlyLlmCallLimit)
            return Reply(AssistantTemplates.buttonMode(hasTrip), streak = Streak.KEEP)
        }

        // 컨텍스트를 먼저 읽는다 — 그 시간도 턴 예산에서 나가고, 여기서 실패한 것은 상대가 아니라 우리 원천이다.
        val snapshot = runCatching { snapshots.build(session.accountId, session.tripId, surface, today(startedAt)) }.getOrElse { e ->
            log.warn("도우미 컨텍스트를 읽지 못했습니다 — 폴백으로 답합니다. sessionId={} type={}", session.sessionId, e.javaClass.simpleName)
            return Reply(AssistantTemplates.fallback(FallbackCause.SOURCE_UNAVAILABLE), streak = Streak.KEEP)
        }

        // 남은 예산에서 왕복 여유를 뺀 만큼만 준다 — 모자라면 부르지 않는다(PERF-U8-01·02).
        val remaining = properties.turnBudgetMs - Duration.between(startedAt, clock.instant()).toMillis()
        val deadlineMs = minOf(properties.interpretStageMaxMs, remaining - properties.readMarginMs)
        if (deadlineMs <= 0) return Reply(AssistantTemplates.fallback(FallbackCause.AI_UNAVAILABLE), streak = Streak.KEEP)
        val interpretation = runCatching {
            port.interpret(
                InterpretRequest(
                    utterance = utterance, surface = surface,
                    context = snapshot,
                    dialogueContext = bumpTurnIndex(session.dialogueContext),
                    requestedAt = startedAt, deadlineMs = deadlineMs,
                ),
            )
        }.getOrElse { e ->
            log.warn("도우미 해석 실패 — 폴백으로 답합니다. sessionId={} type={}", session.sessionId, e.javaClass.simpleName)
            return Reply(AssistantTemplates.fallback(FallbackCause.AI_UNAVAILABLE), streak = Streak.KEEP)
        }
        return answer(interpretation, session, surface, utterance, startedAt)
    }

    private fun answer(result: Interpretation, session: AssistantSession, surface: AssistantSurface, utterance: String, startedAt: Instant): Reply {
        val hasTrip = session.tripId != null
        // 해석이 끝난 뒤에 무엇이 잘못돼도 **맥락과 LLM 사용은 남긴다** — 버리면 쓴 LLM 턴이 안 세어지고 보류 중인 되묻기가 사라진다.
        // 처리기가 상대를 한 번 더 불렀으면(발화 편집) 그것도 더한다.
        fun reply(message: NewMessage, streak: Streak = Streak.NORMAL): Reply {
            val llmCalls = result.llmCalls + (message.llmCalls ?: 0)
            return Reply(
                message.copy(llmCalls = llmCalls, matchRoute = result.frames.firstOrNull()?.matchRoute ?: message.matchRoute),
                dialogueContext = result.dialogueContext, streak = streak, llm = llmCalls >= 1,
            )
        }
        fun broken(what: String): Reply {
            log.warn("도우미 해석 응답이 계약과 다릅니다({}) — 폴백으로 답합니다. sessionId={}", what, session.sessionId)
            return reply(AssistantTemplates.fallback(FallbackCause.AI_UNAVAILABLE), Streak.KEEP)
        }
        return runCatching {
            if (result.outcome == InterpretOutcome.OUT_OF_SCOPE) {
                val scope = dispatcher.dispatch(Intent.OUT_OF_SCOPE, context(session, surface, startedAt)).copy(intent = Intent.OUT_OF_SCOPE.name)
                return@runCatching reply(refuse(session, scope, outcome = "OUT_OF_SCOPE").message, Streak.REFUSED)
            }
            // 프레임이 여럿이면 실행하지 않는다(DEC-U8-11) — 여러 요청 중 하나를 골라 하면 반드시 틀린다.
            if (result.frames.size > 1) return@runCatching reply(AssistantTemplates.oneAtATime(hasTrip), Streak.KEEP)
            val frame = result.frames.singleOrNull() ?: return@runCatching broken("frames 가 비었다")
            when (result.outcome) {
                InterpretOutcome.ARGUMENT_CLARIFY -> {
                    val clarify = result.clarify ?: return@runCatching broken("되묻기인데 clarify 가 없다")
                    reply(AssistantTemplates.clarify(clarify.argument, clarify.question, clarify.options).copy(intent = frame.intent.name))
                }
                // 상대가 돌려준 인자에서 **서버 발급 전용 키는 걸러 낸다** — 지어낸 슬롯·장소로 교체를 시키지 못하게(SEC-U8-03).
                else -> reply(dispatched(frame.intent, frame.matchRoute, session, surface, startedAt, frame.arguments - SERVER_ISSUED_ARGUMENTS, utterance).message)
            }
        }.getOrElse { e ->
            log.warn("도우미 응답 조립 실패 — 폴백으로 답합니다. sessionId={} type={}", session.sessionId, e.javaClass.simpleName)
            reply(AssistantTemplates.fallback(FallbackCause.SOURCE_UNAVAILABLE), Streak.KEEP)
        }
    }

    private fun dispatched(
        intent: Intent, matchRoute: String?, session: AssistantSession, surface: AssistantSurface, startedAt: Instant,
        arguments: Map<String, String> = emptyMap(), utterance: String? = null,
    ) = Reply(
        dispatcher.dispatch(intent, context(session, surface, startedAt, arguments, utterance)).copy(intent = intent.name, matchRoute = matchRoute ?: "ACTION"),
    )

    private fun context(
        session: AssistantSession, surface: AssistantSurface, startedAt: Instant, arguments: Map<String, String> = emptyMap(), utterance: String? = null,
    ): DispatchContext {
        val now = clock.instant()
        val trip = session.tripId?.let { tripContexts.read(session.accountId, it) }
        return DispatchContext(
            accountId = session.accountId,
            // 여행을 못 읽었으면(그 사이 삭제) 여행 없는 대화로 다룬다 — 처리기가 없는 여행을 읽으려 들지 않게.
            tripId = session.tripId.takeIf { trip != null },
            trip = trip, inTrip = trip?.inTrip(today(now)) ?: false, surface = surface, arguments = arguments, now = now,
            utterance = utterance,
            // 남은 턴 예산에서 왕복 여유를 뺀 만큼만(해석과 같은 셈). 0 이하면 처리기가 부르지 않고 폴백한다.
            deadlineMs = minOf(properties.editStageMaxMs, properties.turnBudgetMs - Duration.between(startedAt, now).toMillis() - properties.readMarginMs),
        )
    }

    /** 거절이 이어지면 같은 거절을 되풀이하지 않고 쓰는 법을 안내한다(BR-U8-25). */
    private fun refuse(session: AssistantSession, message: NewMessage, outcome: String = "REFUSAL"): Reply = Reply(
        if (session.refusalStreak + 1 >= REFUSALS_BEFORE_GUIDE) AssistantTemplates.usageGuide(session.tripId != null, outcome) else message,
        streak = Streak.REFUSED,
    )

    /**
     * `turn_index` 만 하나 올린다 — 나머지는 읽지도 고치지도 **만들지도** 않는다(INV-U8-07). 같은 규칙을 두 곳이 판정하면
     * 갈라진다. 맥락이 아직 없으면(첫 턴) 순번만 있는 맥락이 간다 — 나머지 칸의 기본값은 상대가 정한다.
     */
    internal fun bumpTurnIndex(dialogueContext: String): String {
        val node = mapper.readTree(dialogueContext) as? ObjectNode ?: mapper.createObjectNode()
        node.put("turn_index", (node.get("turn_index")?.asInt() ?: 0) + 1)
        return mapper.writeValueAsString(node)
    }

    // ── 3. 남기기 ──────────────────────────────────────────────────────────

    /** @return 남긴(또는 이미 남아 있던) 응답. **null 이면 그 사이 대화가 지워진 것이다** — 아무것도 쓰지 않았다. */
    private fun finish(turn: Accepted.New, clientTurnId: UUID, reply: Reply, startedAt: Instant, finishedAt: Instant): List<AssistantMessage>? {
        val session = turn.session
        // 같은 턴이 겹쳐 처리됐으면(넘겨받기가 둘 이상 겹친 드문 경우) 먼저 끝난 쪽만 남긴다 — 줄을 세우고 다시 본다.
        // 늦은 쪽은 응답을 쓰지 않는다. 다만 LLM 을 실제로 썼으면 그 한 번은 센다 — 안 세면 겹쳐 보내기가 상한 우회가 된다.
        lock.acquire(session.accountId)
        val recorded = messages.findTurn(session.sessionId, clientTurnId) ?: return null // 사용자 행까지 사라졌다 — 대화가 지워졌다
        recorded.replies.takeIf { it.isNotEmpty() }?.let { existing ->
            if (reply.llm) usage.record(session.accountId, today(startedAt), llm = true, turn = false)
            return existing
        }
        val stored = messages.appendAssistant(
            session.sessionId, session.accountId, clientTurnId,
            reply.message.copy(latencyMs = Duration.between(startedAt, finishedAt).toMillis().toInt()), finishedAt,
        )
        sessions.recordTurn(
            sessionId = session.sessionId, at = finishedAt, expiresAt = finishedAt + properties.retention,
            // 해석을 안 탄 턴도 턴은 지나갔다 — 순번만 올린다. 보류 중인 되묻기의 폐기는 상대가 그 순번으로 판정한다.
            dialogueContext = reply.dialogueContext ?: bumpTurnIndex(session.dialogueContext),
            refusalStreak = when (reply.streak) {
                Streak.REFUSED -> session.refusalStreak + 1
                Streak.NORMAL -> 0
                Streak.KEEP -> session.refusalStreak
            },
        )
        usage.record(session.accountId, today(startedAt), llm = reply.llm)
        return listOf(stored)
    }

    private fun today(at: Instant): LocalDate = LocalDate.ofInstant(at, TRAVEL_ZONE)

    companion object {
        /** 상대 계약의 발화 상한과 같다(FD §3.1). */
        const val MAX_UTTERANCE_LENGTH = 500
        private val WINDOW: Duration = Duration.ofSeconds(60)
        private const val REFUSALS_BEFORE_GUIDE = 2
        private val SERVER_ISSUED_ARGUMENTS = setOf(ProposalCards.ARG_SLOT_KEY, ProposalCards.ARG_POI_ID)
        private const val POLL_MS = 200L
        internal const val MAX_WAITERS_PER_TURN = 2
        private val TRAVEL_ZONE: ZoneId = ZoneId.of("Asia/Seoul")
        private val log = LoggerFactory.getLogger(AssistantTurnService::class.java)
    }
}
