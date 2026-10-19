package com.trippilot.assistant.application

import com.fasterxml.jackson.databind.ObjectMapper
import com.trippilot.assistant.adapter.out.interpret.HttpDialogueInterpreter
import com.trippilot.assistant.adapter.out.interpret.WireAnswer
import com.trippilot.assistant.adapter.out.interpret.WireFrame
import com.trippilot.assistant.adapter.out.interpret.WireNextAction
import com.trippilot.assistant.adapter.out.interpret.WireQuickReply
import com.trippilot.assistant.adapter.out.interpret.WireResponse
import com.trippilot.assistant.adapter.out.interpret.toDomain
import com.trippilot.assistant.domain.AccountTurnLock
import com.trippilot.assistant.domain.AnswerKind
import com.trippilot.assistant.domain.AssistantMessage
import com.trippilot.assistant.domain.AssistantMessageRepository
import com.trippilot.assistant.domain.AssistantSession
import com.trippilot.assistant.domain.AssistantSurface
import com.trippilot.assistant.domain.Clarify
import com.trippilot.assistant.domain.DialogueInterpretFailed
import com.trippilot.assistant.domain.DialogueInterpretPort
import com.trippilot.assistant.domain.Intent
import com.trippilot.assistant.domain.IntentFrame
import com.trippilot.assistant.domain.InterpretOutcome
import com.trippilot.assistant.domain.InterpretRequest
import com.trippilot.assistant.domain.Interpretation
import com.trippilot.assistant.domain.InterpretedAnswer
import com.trippilot.assistant.domain.InterpretedQuickReply
import com.trippilot.assistant.domain.MessageKind
import com.trippilot.assistant.domain.MessageRole
import com.trippilot.assistant.domain.NewMessage
import com.trippilot.assistant.domain.NextAction
import com.trippilot.assistant.domain.QuickReplyAction
import com.trippilot.core.error.ErrorCode
import com.trippilot.core.error.RateLimited
import com.trippilot.itinerarygeneration.api.EditProposal
import com.trippilot.itinerarygeneration.api.EditProposalRequest
import com.trippilot.itinerarygeneration.api.ProposalViolation
import com.trippilot.itinerarygeneration.api.ProposedDay
import com.trippilot.itinerarygeneration.api.SlotCandidateView
import com.trippilot.itinerarygeneration.api.SlotCandidatesView
import com.trippilot.core.error.ResourceNotFound
import com.trippilot.core.error.ValidationFailed
import com.trippilot.moderation.api.ModerationVerdict
import com.trippilot.moderation.api.TextModerationFacade
import com.trippilot.savedaccommodation.api.DayBaseStayView
import com.trippilot.savedaccommodation.api.TripBaseStayFacade
import com.trippilot.trip.api.TripDestinationRef
import com.trippilot.trip.api.TripFacade
import com.trippilot.trip.api.TripGenerationContext
import com.trippilot.trip.api.TripPeriod
import com.trippilot.weathercontext.api.WeatherReading
import io.kotest.assertions.throwables.shouldThrow
import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.collections.shouldContainExactly
import io.kotest.matchers.ints.shouldBeLessThanOrEqual
import io.kotest.matchers.shouldBe
import io.kotest.property.Arb
import io.kotest.property.arbitrary.Codepoint
import io.kotest.property.arbitrary.alphanumeric
import io.kotest.property.arbitrary.element
import io.kotest.property.arbitrary.enum
import io.kotest.property.arbitrary.filter
import io.kotest.property.arbitrary.int
import io.kotest.property.arbitrary.list
import io.kotest.property.arbitrary.map
import io.kotest.property.arbitrary.string
import io.kotest.property.checkAll
import org.springframework.beans.factory.ObjectProvider
import org.springframework.dao.DataIntegrityViolationException
import java.time.Clock
import java.time.Duration
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.util.UUID

/**
 * 한 턴의 규칙(FD §2 · BR-U8-22~45). 요점은 **무엇이 잘못돼도 턴이 도우미 메시지 한 건으로 끝나고,
 * 그 메시지에 다음 행동이 있다**는 것이다 — 침묵 실패도 막다른 응답도 없다(INV-4 · BR-U8-06).
 *
 * 분당 제한의 동시성(잠금)과 DB 제약은 `AssistantTurnIT` 가 실 DB 로 잰다.
 */
class AssistantTurnServiceTest : StringSpec({

    val acc = UUID.randomUUID()
    val tripId = UUID.randomUUID()
    val start = Instant.parse("2026-10-13T03:00:00Z") // 정오(KST)
    val today = LocalDate.parse("2026-10-13")
    val json = ObjectMapper()

    /** 시각을 테스트가 민다 — 창·예산을 결정론으로 잰다. */
    class MovingClock(var now: Instant) : Clock() {
        override fun getZone(): ZoneId = ZoneId.of("UTC")
        override fun withZone(zone: ZoneId): Clock = this
        override fun instant(): Instant = now
    }

    class Interpreter(var answer: (InterpretRequest) -> Interpretation) : DialogueInterpretPort {
        val requests = mutableListOf<InterpretRequest>()
        override fun interpret(request: InterpretRequest): Interpretation {
            requests += request
            return answer(request)
        }
    }
    fun framed(intent: Intent, llmCalls: Int = 0) = { r: InterpretRequest ->
        Interpretation(InterpretOutcome.FRAME, listOf(IntentFrame(intent, emptyMap(), "CONFIDENT")), null, r.dialogueContext, llmCalls)
    }
    fun provider(port: DialogueInterpretPort?) = object : ObjectProvider<DialogueInterpretPort> {
        override fun getObject(): DialogueInterpretPort = port!!
        override fun getIfAvailable(): DialogueInterpretPort? = port
    }

    /** 여행은 오늘부터 이틀 — 그래서 "여행 중"이다. */
    val trips = object : TripFacade {
        override fun findPeriod(accountId: UUID, tripId: UUID): TripPeriod? = null
        override fun findGenerationContext(accountId: UUID, id: UUID) =
            TripGenerationContext(today, today.plusDays(1), listOf(TripDestinationRef("부산", null, 1)), "친구", null, emptyList())
    }
    val stays = object : TripBaseStayFacade {
        override fun findBaseStays(tripId: UUID, startDate: LocalDate, endDate: LocalDate) = emptyList<DayBaseStayView>()
    }
    val clean = object : TextModerationFacade {
        override fun inspect(text: String) = ModerationVerdict(clean = "금칙" !in text, category = "PROFANITY".takeIf { "금칙" in text })
    }

    class World(
        val sessions: FakeSessions = FakeSessions(),
        val memory: FakeDialogueMemory = FakeDialogueMemory(),
        val messages: FakeMessages = FakeMessages(),
        val usage: FakeUsage = FakeUsage(),
        val clock: MovingClock,
        val interpreter: Interpreter?,
        val data: FakeTripData,
        val editing: FakeEditing = FakeEditing(),
    ) {
        /** 같은 턴의 앞선 처리를 기다리는 동안 일어날 일 — 테스트가 "그 사이 앞선 처리가 끝났다"를 심는다. */
        var onPause: () -> Unit = {}
    }

    fun world(
        intent: Intent = Intent.GET_WEATHER,
        interpreter: Interpreter? = Interpreter(framed(intent)),
    ) = World(
        clock = MovingClock(start), interpreter = interpreter,
        // 오늘 저녁에 갈 곳 하나와 신선한 예보 — 조회 카드가 값으로 답할 재료
        data = FakeTripData(acc, slots = listOf(plannedSlot(today, 0, "18:00", "카페 모카", distance = "840m")), reading = WeatherReading(30, null, start, stale = false)),
    )

    fun World.service(
        moderation: TextModerationFacade = clean,
        properties: AssistantProperties = AssistantProperties(),
        store: AssistantMessageRepository = messages,
    ) = AssistantTurnService(
        sessions, store, usage, AccountTurnLock { }, moderation, provider(interpreter), dispatcher(data, editing, properties),
        TripContextReader(trips, stays), ContextSnapshotBuilder(TripContextReader(trips, stays), data, data, properties), data, data, memory, properties, json, clock, NOOP_TX,
    ).also { it.pause = { ms -> clock.now = clock.now.plusMillis(ms); onPause() } } // 기다림은 시계를 민다

    fun World.session(withTrip: Boolean = true): AssistantSession =
        AssistantSession(UUID.randomUUID(), acc, tripId.takeIf { withTrip }, start, start, start.plusSeconds(3600)).also { sessions.rows += it }

    fun World.say(session: AssistantSession, text: String, turn: UUID = UUID.randomUUID(), service: AssistantTurnService = service()) =
        service.send(acc, session.sessionId, turn, TurnInput.Text(text), AssistantSurface.ITINERARY)

    fun World.press(session: AssistantSession, id: String, service: AssistantTurnService = service()) =
        service.send(acc, session.sessionId, UUID.randomUUID(), TurnInput.Action(id), AssistantSurface.ITINERARY)

    fun World.row(seq: Long) = messages.rows.single { it.message.seq == seq }

    "말을 하면 사용자 메시지 하나와 다음 행동이 있는 도우미 메시지 하나가 남는다" {
        val w = world(Intent.GET_WEATHER)
        val s = w.session()
        w.clock.now = start.plusMillis(40)

        val result = w.say(s, "오늘 날씨 어때")

        result.messages.map { it.role } shouldContainExactly listOf(MessageRole.USER, MessageRole.ASSISTANT)
        result.messages[0].text shouldBe "오늘 날씨 어때"
        result.messages[1].nextActions.map { it.type } shouldContainExactly listOf("OPEN_ITINERARY")
        // 메시지가 빠른 답을 정하지 않았으면 대화의 시작 빠른 답이 입력창 위에 온다
        result.quickReplies.map { it.id } shouldContainExactly StartQuickReplies.of(true).map { it.id }

        // 해석에는 발화와 화면, 순번을 올린 맥락만 간다
        val sent = w.interpreter!!.requests.single()
        sent.utterance shouldBe "오늘 날씨 어때"
        sent.surface shouldBe AssistantSurface.ITINERARY
        // 서버가 직접 읽은 컨텍스트가 함께 간다 — 앱이 보낸 일정 내용이 아니다(BR-U8-02)
        sent.context.trip!!.regions shouldContainExactly listOf("부산")
        sent.context.itinerary!!.days.single().slots.single().name shouldBe "카페 모카"
        json.readTree(sent.dialogueContext)["turn_index"].asInt() shouldBe 1
        // 상대 메모리의 키와 단기 기억 — 첫 턴이라 앞선 대화는 없다(이번 발화는 `utterance` 로 가고 여기엔 안 실린다)
        sent.sessionId shouldBe s.sessionId
        sent.accountRef shouldBe acc.toString()
        sent.recentTurns shouldBe emptyList()

        // 관측 칸(OBS-U8-01)과 세션·사용량
        val saved = w.row(2).saved
        saved.intent shouldBe "GET_WEATHER"
        saved.matchRoute shouldBe "CONFIDENT"
        saved.outcome shouldBe "FRAME"
        saved.llmCalls shouldBe 0
        (saved.latencyMs != null) shouldBe true
        val after = w.sessions.rows.single()
        after.lastTurnAt shouldBe w.clock.now
        after.expiresAt shouldBe w.clock.now + Duration.ofDays(90)
        json.readTree(after.dialogueContext)["turn_index"].asInt() shouldBe 1
        w.usage.turns[acc to today] shouldBe 1
        w.usage.llm[acc to today] shouldBe null
    }

    "남의 대화에는 턴을 보낼 수 없다(404) — 아무것도 남지 않는다" {
        val w = world()
        val s = w.session()

        shouldThrow<ResourceNotFound> { w.service().send(UUID.randomUUID(), s.sessionId, UUID.randomUUID(), TurnInput.Text("안녕"), AssistantSurface.HOME) }
        w.messages.rows shouldBe emptyList()
    }

    /** PBT-U8-5 — 앱은 응답을 못 받으면 같은 턴 id 로 다시 보낸다(BR-U8-21). 두 번 만들면 대화가 겹친다. */
    "같은 턴을 몇 번 보내도 메시지는 한 쌍이고 응답이 같다" {
        checkAll(20, Arb.int(2..5), Arb.enum<Intent>()) { times, intent ->
            val w = world(intent)
            val s = w.session()
            val turn = UUID.randomUUID()

            val results = List(times) { w.say(s, "검토해줘", turn) }

            results.map { r -> r.messages.map { it.messageId } }.distinct().size shouldBe 1
            results.map { it.quickReplies }.distinct().size shouldBe 1
            w.messages.rows.size shouldBe 2
            w.interpreter!!.requests.size shouldBe 1
            w.usage.turns[acc to today] shouldBe 1
        }
    }

    /** 사용자 행만 남고 응답 저장이 실패한 턴(한참 전) — 재전송은 사용자 행을 다시 만들지 않고 이어서 답한다. */
    "응답 없이 끊긴 턴을 다시 보내면 사용자 행은 그대로 두고 답만 채운다 — 기다리지 않는다" {
        val w = world()
        val s = w.session()
        val turn = UUID.randomUUID()
        w.messages.appendUser(s.sessionId, acc, turn, NewMessage(MessageRole.USER, MessageKind.TEXT, "오늘 날씨"), start.minusSeconds(60))

        val result = w.say(s, "오늘 날씨", turn)

        result.messages.map { it.role } shouldContainExactly listOf(MessageRole.USER, MessageRole.ASSISTANT)
        result.messages[1].nextActions.single().type shouldBe "OPEN_ITINERARY" // 제대로 해석해 답했다
        w.messages.rows.size shouldBe 2
        w.clock.now shouldBe start // 앞선 처리는 이미 죽었다 — 기다릴 것이 없다
    }

    /**
     * 앱이 대기를 취소하고 같은 턴 id 로 다시 보내면 서버의 첫 처리는 아직 돌고 있다. 뒤쪽이 또 해석하면 응답이 둘이 되고,
     * 여러 번 겹쳐 보내 해석을 그만큼 돌리는 것이 분당 제한·하루 LLM 상한의 우회가 된다 — **기다렸다가 앞쪽의 답을 준다.**
     */
    "같은 턴이 아직 처리 중이면 다시 해석하지 않고 그 응답을 기다린다" {
        val w = world()
        val s = w.session()
        val turn = UUID.randomUUID()
        w.messages.appendUser(s.sessionId, acc, turn, NewMessage(MessageRole.USER, MessageKind.TEXT, "오늘 날씨"), start)
        var pauses = 0
        w.onPause = {
            // 세 번째로 들여다볼 때쯤 앞선 처리가 답을 남겼다
            if (++pauses == 3) w.messages.appendAssistant(s.sessionId, acc, turn, AssistantTemplates.capabilities(true), w.clock.now)
        }

        val result = w.say(s, "오늘 날씨", turn)

        result.messages.map { it.role } shouldContainExactly listOf(MessageRole.USER, MessageRole.ASSISTANT)
        result.messages[1].messageId shouldBe w.messages.rows.last().message.messageId
        w.interpreter!!.requests shouldBe emptyList()
        w.messages.rows.size shouldBe 2
        w.usage.turns[acc to today] shouldBe null // 턴과 사용량은 앞선 처리의 몫이다
    }

    /** 같은 턴 id 를 N 번 겹쳐 보내면 기다리는 스레드가 N 개 선다 — 해석이 십여 초 가면 그만큼 요청 스레드가 마른다. */
    "같은 턴을 기다리는 요청은 턴마다 둘까지다 — 넘치면 429, 다른 턴은 막지 않고, 대기가 끝나면 세는 칸이 비워진다" {
        val w = world()
        val s = w.session()
        val turn = UUID.randomUUID()
        val other = UUID.randomUUID()
        w.messages.appendUser(s.sessionId, acc, turn, NewMessage(MessageRole.USER, MessageKind.TEXT, "오늘 날씨"), start)
        val parked = java.util.concurrent.CountDownLatch(AssistantTurnService.MAX_WAITERS_PER_TURN)
        val release = java.util.concurrent.CountDownLatch(1)
        val answeringOther = java.util.concurrent.atomic.AtomicBoolean(false)
        val service = w.service()
        service.pause = {
            if (answeringOther.get()) {
                // 다른 턴의 대기 — 앞선 처리가 곧 답을 남긴다
                w.messages.appendAssistant(s.sessionId, acc, other, AssistantTemplates.capabilities(true), w.clock.now)
            } else {
                parked.countDown()
                // 상한이 없으면 셋째도 여기 붙들린다 — 풀리지 않으면 매달리는 대신 실패로 끝낸다
                if (!release.await(5, java.util.concurrent.TimeUnit.SECONDS)) error("대기에 붙들렸다 — 429 여야 했다")
            }
        }
        fun send(t: UUID) = service.send(acc, s.sessionId, t, TurnInput.Text("오늘 날씨"), AssistantSurface.ITINERARY)
        // 공용 풀(ForkJoinPool.commonPool)을 쓰지 않는다 — CPU 2개면 병렬도가 1 이라 둘째가 첫째 뒤에 줄을 선다
        val pool = java.util.concurrent.Executors.newFixedThreadPool(AssistantTurnService.MAX_WAITERS_PER_TURN)
        val waiting = (1..AssistantTurnService.MAX_WAITERS_PER_TURN).map {
            java.util.concurrent.CompletableFuture.supplyAsync({ runCatching { send(turn) } }, pool)
        }
        parked.await(5, java.util.concurrent.TimeUnit.SECONDS) shouldBe true // 둘이 대기에 들어가지 못했으면 매달리지 않고 실패한다

        // 분당 제한의 429 와 다른 코드다 — 앱은 이것을 "기록돼 처리 중, 같은 id 로 다시"로 읽어야 한다
        shouldThrow<RateLimited> { send(turn) }.errorCode shouldBe ErrorCode.TURN_IN_PROGRESS
        // 다른 턴도 처리 중이면 기다린다 — 상한은 턴마다라 이 턴의 두 대기가 막지 않는다
        w.messages.appendUser(s.sessionId, acc, other, NewMessage(MessageRole.USER, MessageKind.TEXT, "오늘 날씨"), start)
        answeringOther.set(true)
        send(other).messages.size shouldBe 2
        answeringOther.set(false)

        // 앞선 처리가 답을 남기고 대기가 풀린다
        w.messages.appendAssistant(s.sessionId, acc, turn, AssistantTemplates.capabilities(true), w.clock.now)
        release.countDown()
        waiting.forEach { it.get().getOrThrow().messages.size shouldBe 2 }
        service.waitingTurns shouldBe 0
        pool.shutdown()
    }

    "기다리는 사이나 답하는 사이 대화가 지워지면 404 다 — 그래도 쓴 LLM 은 센다" {
        // 기다리는 사이
        val waiting = world()
        val s1 = waiting.session()
        val turn = UUID.randomUUID()
        waiting.messages.appendUser(s1.sessionId, acc, turn, NewMessage(MessageRole.USER, MessageKind.TEXT, "오늘 날씨"), start)
        waiting.onPause = { waiting.messages.rows.clear() } // 이력 지우기 — 사용자 행까지 사라진다
        shouldThrow<ResourceNotFound> { waiting.say(s1, "오늘 날씨", turn) }

        // 답하는 사이(해석 도중) — LLM 은 이미 썼다. 안 세면 "보내고 지우기"가 하루 상한의 우회가 된다
        lateinit var answering: World
        answering = world(interpreter = Interpreter { r ->
            answering.messages.rows.clear()
            framed(Intent.GET_WEATHER, llmCalls = 1)(r)
        })
        val s2 = answering.session()

        shouldThrow<ResourceNotFound> { answering.say(s2, "오늘 날씨") }

        answering.messages.rows shouldBe emptyList()
        answering.usage.llm[acc to today] shouldBe 1
        answering.usage.turns[acc to today] shouldBe null
        // 상대는 답하기 전에 그 세션의 요약을 썼다 — 파기가 먼저 끝났어도 되살아난 행을 한 번 더 지운다(2026-10-18 리뷰)
        answering.memory.deleted shouldContainExactly listOf("session:${s2.sessionId}")
        waiting.memory.deleted shouldBe emptyList() // 기다리던 쪽은 상대를 부르지 않았다 — 되살릴 것이 없다
    }

    /**
     * 대화가 그대로 있는데 응답 저장이 제약에 걸렸다면 우리 결함이다(다음 행동 없는 응답·길이 초과…). 404 로 가리면
     * 응답 없는 턴이 남아 재전송마다 다시 해석한다 — 그대로 올려 드러낸다.
     */
    "대화가 있는데 응답 저장이 제약에 걸리면 404 로 가리지 않는다" {
        val w = world()
        val s = w.session()
        val broken = object : AssistantMessageRepository by w.messages {
            override fun appendAssistant(sessionId: UUID, accountId: UUID, replyTo: UUID, message: NewMessage, at: Instant): AssistantMessage =
                throw DataIntegrityViolationException("ck_assistant_message_next_action")
        }

        shouldThrow<DataIntegrityViolationException> { w.say(s, "오늘 날씨", service = w.service(store = broken)) }
    }

    /**
     * 응답은 위치가 아니라 **턴에** 묶인다. 앱이 대기를 취소하고 새 말을 보내면 앞선 턴은 아직 처리 중이다 —
     * 위치로 묶으면 먼저 끝난 쪽의 답이 다른 턴의 답으로 읽히고, 한쪽은 영영 응답 없는 턴이 된다.
     */
    "서로 다른 두 턴이 겹쳐 처리돼도 답은 각자의 턴에 붙는다" {
        val (a, b) = UUID.randomUUID() to UUID.randomUUID()
        lateinit var w: World
        lateinit var s: AssistantSession
        var nested = false
        w = world(interpreter = Interpreter { r ->
            // A 가 해석 중일 때 B 가 들어와 먼저 끝난다
            if (!nested) {
                nested = true
                w.say(s, "스타일 분석해줘", b)
            }
            framed(if ("날씨" in r.utterance) Intent.GET_WEATHER else Intent.STYLE_ANALYSIS)(r)
        })
        s = w.session()

        val first = w.say(s, "오늘 날씨", a)

        first.messages.map { it.text } shouldContainExactly listOf("오늘 날씨", "오늘 예보예요.")
        w.messages.rows.map { it.message.role } shouldContainExactly
            listOf(MessageRole.USER, MessageRole.USER, MessageRole.ASSISTANT, MessageRole.ASSISTANT)
        // 다시 보내면 각자 처음 응답을 그대로 받는다 — 새 행도, 새 해석도 없다
        w.say(s, "오늘 날씨", a).messages.map { it.messageId } shouldContainExactly first.messages.map { it.messageId }
        w.say(s, "스타일 분석해줘", b).messages.map { it.text } shouldContainExactly listOf("스타일 분석해줘", "여행 스타일은 기록에서 볼 수 있어요. 아래 버튼을 누르면 바로 열려요.")
        w.messages.rows.size shouldBe 4
        w.interpreter!!.requests.size shouldBe 2
        w.usage.turns[acc to today] shouldBe 2
    }

    "분당 20턴을 넘기면 429 다 — 거절된 턴은 남지 않고, 창이 지나면 다시 받는다" {
        val w = world()
        val s = w.session()
        repeat(20) {
            w.say(s, "날씨")
            w.clock.now = w.clock.now.plusSeconds(1)
        }
        val before = w.messages.rows.size
        w.clock.now = w.clock.now.plusMillis(100)

        val limited = shouldThrow<RateLimited> { w.say(s, "날씨") }

        // 첫 턴(0초)이 창에서 빠지는 60초까지 39.9초 — 올린다. 내리면 39초 뒤에 다시 보낸 요청이 또 429 다
        limited.retryAfterSeconds shouldBe 40
        w.messages.rows.size shouldBe before
        w.clock.now = start.plusSeconds(60)
        w.say(s, "날씨").messages.size shouldBe 2
    }

    /** PBT-U8-4 — 어느 60초 창에서도 받은 턴은 20 이하다. 빠른 답도 센다(LLM 은 0회지만 남용 경로다). */
    "임의의 간격으로 보내도 어느 60초 창에서든 받은 턴은 20 이하다" {
        checkAll(30, Arb.list(Arb.int(0..7), 30..80)) { gaps ->
            val w = world()
            val s = w.session()
            gaps.forEachIndexed { i, gap ->
                w.clock.now = w.clock.now.plusSeconds(gap.toLong())
                runCatching { if (i % 3 == 0) w.press(s, "qr-capabilities") else w.say(s, "날씨") }
                    .exceptionOrNull()?.let { (it is RateLimited) shouldBe true }
            }
            val accepted = w.messages.rows.filter { it.message.role == MessageRole.USER }.map { it.message.createdAt }
            accepted.forEach { end ->
                accepted.count { it > end.minusSeconds(60) && it <= end } shouldBeLessThanOrEqual 20
            }
            // 받은 턴마다 응답이 하나씩 — 거절된 턴은 어느 쪽에도 없다
            w.messages.rows.count { it.message.role == MessageRole.ASSISTANT } shouldBe accepted.size
        }
    }

    "빈 말·500자 넘는 말·발급한 적 없는 빠른 답은 400 이고 아무것도 남지 않는다" {
        val w = world()
        val s = w.session()

        shouldThrow<ValidationFailed> { w.say(s, "   ") }
        shouldThrow<ValidationFailed> { w.say(s, "가".repeat(501)) }
        shouldThrow<ValidationFailed> { w.press(s, "qr-made-up") }
        w.messages.rows shouldBe emptyList()
        w.say(s, "가".repeat(500)).messages.size shouldBe 2
    }

    /** BR-U8-23 — 상대를 부르기 전에 막고, 원문을 계정 기록에 쌓지 않는다. */
    "금칙어는 해석 전에 걸러지고 원문이 저장되지 않는다 — 이어지면 같은 거절 대신 쓰는 법을 안내한다" {
        val w = world()
        val s = w.session()

        val first = w.say(s, "금칙 문장")

        first.messages[0].text shouldBe null
        w.row(1).saved.redacted shouldBe true
        first.messages[1].kind shouldBe MessageKind.REFUSAL
        first.messages[1].payload!!["category"] shouldBe "POLICY"
        w.interpreter!!.requests shouldBe emptyList()
        w.sessions.rows.single().refusalStreak shouldBe 1

        val second = w.say(s, "또 금칙")
        second.messages[1].kind shouldBe MessageKind.TEXT // 같은 거절을 되풀이하지 않는다(BR-U8-25)
        w.row(4).saved.outcome shouldBe "REFUSAL"
        w.sessions.rows.single().refusalStreak shouldBe 2

        w.say(s, "오늘 날씨")
        w.sessions.rows.single().refusalStreak shouldBe 0
    }

    "입력 검사를 할 수 없으면 통과가 아니라 폴백이다 — 확인 못 한 문장은 저장하지도 해석하지도 않는다" {
        val w = world()
        val s = w.session()
        val broken = object : TextModerationFacade {
            override fun inspect(text: String): ModerationVerdict = throw IllegalStateException("사전 없음")
        }

        val result = w.say(s, "오늘 날씨", service = w.service(moderation = broken))

        result.messages[0].text shouldBe null
        result.messages[1].kind shouldBe MessageKind.FALLBACK
        result.messages[1].payload!!["cause"] shouldBe "SOURCE_UNAVAILABLE"
        // 그 문장은 저장하지 않았다 — [다시 시도]를 주면 엉뚱한 옛 문장을 다시 보내게 된다
        result.messages[1].nextActions.map { it.type } shouldContainExactly listOf("CONTINUE_WITHOUT_ASSISTANT")
        result.quickReplies.map { it.id } shouldContainExactly listOf("qr-capabilities")
        w.interpreter!!.requests shouldBe emptyList()
    }

    /** BR-U8-40·41·45 — 해석이 죽어도 턴은 폴백 한 건으로 끝나고, 도우미 없이 계속할 길이 있다. */
    "해석이 실패하면 폴백 메시지 정확히 한 건 — 다시 시도와 '도우미 없이 계속'이 있다" {
        val w = world(interpreter = Interpreter { throw DialogueInterpretFailed("timeout") })
        val s = w.session()

        val result = w.say(s, "오늘 날씨")

        result.messages.size shouldBe 2
        result.messages[1].kind shouldBe MessageKind.FALLBACK
        result.messages[1].payload!!["cause"] shouldBe "AI_UNAVAILABLE"
        result.messages[1].nextActions.map { it.type } shouldContainExactly listOf("RETRY_TURN", "CONTINUE_WITHOUT_ASSISTANT")
        result.quickReplies.map { it.id } shouldContainExactly listOf("qr-retry", "qr-capabilities")
        w.row(2).saved.outcome shouldBe "FALLBACK_AI_UNAVAILABLE"
        w.usage.turns[acc to today] shouldBe 1 // 실패한 턴도 턴이다
        w.usage.llm[acc to today] shouldBe null
    }

    /** 폴백은 사용자의 거절도 정상 턴도 아니다 — 연속 거절 수를 올리지도 지우지도 않는다(BR-U8-25). */
    "폴백은 연속 거절 수를 건드리지 않는다" {
        var fail = false
        val w = world(interpreter = Interpreter { r -> if (fail) throw DialogueInterpretFailed("down") else framed(Intent.GET_WEATHER)(r) })
        val s = w.session()
        w.say(s, "금칙 문장")
        fail = true

        w.say(s, "오늘 날씨")

        w.sessions.rows.single().refusalStreak shouldBe 1
    }

    /**
     * 앱이 대기를 취소하고 같은 턴 id 로 다시 보내면 서버의 첫 처리는 아직 해석 중이다. 둘 다 끝까지 가면
     * 응답이 둘 생기고 사용량이 두 번 세어진다 — 먼저 끝난 쪽만 남는다(INV-U8-05).
     */
    "넘겨받기가 겹쳐 같은 턴이 두 번 처리돼도 응답은 하나고 턴도 한 번 센다 — 쓴 LLM 만 더 센다" {
        val turn = UUID.randomUUID()
        lateinit var w: World
        lateinit var s: AssistantSession
        var inner: TurnResult? = null
        w = world(interpreter = Interpreter { r ->
            // 첫 처리가 해석 중일 때 같은 턴이 다시 들어온다. 그쪽은 턴 예산만큼 기다리다 넘겨받아 먼저 끝난다.
            if (inner == null) {
                inner = TurnResult(emptyList(), emptyList())
                inner = w.say(s, "오늘 날씨", turn)
            }
            framed(Intent.GET_WEATHER, llmCalls = 1)(r)
        })
        s = w.session()

        val outer = w.say(s, "오늘 날씨", turn)

        outer.messages.map { it.messageId } shouldContainExactly inner!!.messages.map { it.messageId }
        w.messages.rows.map { it.message.role } shouldContainExactly listOf(MessageRole.USER, MessageRole.ASSISTANT)
        w.usage.turns[acc to today] shouldBe 1
        w.usage.llm[acc to today] shouldBe 1 // 늦게 끝난 쪽이 쓴 LLM — 안 세면 겹쳐 보내기가 상한 우회가 된다
    }

    "검사를 못 해 가려진 턴을 넘겨받으면 거절이 아니라 처음과 같은 폴백이다" {
        val w = world()
        val s = w.session()
        val turn = UUID.randomUUID()
        w.messages.appendUser(
            s.sessionId, acc, turn,
            NewMessage(MessageRole.USER, MessageKind.TEXT, text = null, redacted = true, outcome = "UNCHECKED"), start.minusSeconds(60),
        )

        val result = w.say(s, "오늘 날씨", turn)

        result.messages[1].kind shouldBe MessageKind.FALLBACK
        w.sessions.rows.single().refusalStreak shouldBe 0
    }

    "해석 응답에 프레임이 없으면 계약이 어긋난 것이다 — 지어내지 않고 폴백한다" {
        val w = world(interpreter = Interpreter { r -> Interpretation(InterpretOutcome.FRAME, emptyList(), null, r.dialogueContext, 1) })
        val s = w.session()

        w.say(s, "오늘 날씨").messages[1].kind shouldBe MessageKind.FALLBACK
        w.usage.llm[acc to today] shouldBe 1 // 쓴 LLM 턴은 센다
    }

    "턴 예산이 1초도 안 남았으면 해석을 부르지 않고 폴백한다 — 남았으면 남은 만큼만 준다" {
        val w = world()
        val s = w.session()
        val slowModeration = object : TextModerationFacade {
            override fun inspect(text: String): ModerationVerdict {
                w.clock.now = w.clock.now.plusMillis(if ("느림" in text) 12_500 else 10_000)
                return ModerationVerdict(true, null)
            }
        }

        w.say(s, "느림", service = w.service(moderation = slowModeration)).messages[1].kind shouldBe MessageKind.FALLBACK
        w.interpreter!!.requests shouldBe emptyList()

        w.clock.now = start.plusSeconds(100)
        w.say(s, "날씨", service = w.service(moderation = slowModeration))
        // 13초 예산에서 10초를 썼고 왕복 여유 1초를 뺀다(PERF-U8-01) — 단계 상한(5초)보다 작은 쪽
        w.interpreter.requests.single().deadlineMs shouldBe 2_000
    }

    /** COST-U8-03 · REL-U8-06 — 막지 않고 낮춘다. 말은 못 알아듣지만 버튼으로는 계속 돕는다. */
    "해석이 꺼져 있거나 하루 LLM 턴을 다 썼으면 버튼 모드로 답한다 — 빠른 답은 그대로 된다" {
        val off = world(interpreter = null)
        val s1 = off.session()
        off.say(s1, "오늘 날씨").messages[1].text shouldBe "지금은 아래 버튼으로 도와드릴게요."
        off.row(2).saved.outcome shouldBe "DOWNGRADED"
        // 버튼 모드에 쓸 버튼이 있어야 한다 — 시작 빠른 답은 전부 해석 없이 답한다(운영 기본값이 이 모드다)
        listOf("qr-review" to "OPEN_ITINERARY", "qr-next" to "OPEN_LIVE", "qr-weather" to "OPEN_ITINERARY", "qr-capabilities" to "OPEN_ITINERARY")
            .forEach { (id, next) -> off.press(s1, id).messages[1].nextActions.first().type shouldBe next }
        val general = off.session(withTrip = false)
        off.press(general, "qr-new-trip").messages[1].nextActions.map { it.type } shouldContainExactly listOf("CREATE_TRIP", "OPEN_STAY_SEARCH")
        off.press(general, "qr-stay").messages[1].nextActions.map { it.type } shouldContainExactly listOf("OPEN_STAY_SEARCH")
        off.messages.rows.filter { it.message.role == MessageRole.ASSISTANT }.drop(1).none { it.saved.outcome == "DOWNGRADED" } shouldBe true

        val capped = world()
        val s2 = capped.session()
        capped.usage.llm[acc to today] = AssistantProperties().dailyLlmTurnLimit
        capped.say(s2, "오늘 날씨")
        capped.row(2).saved.outcome shouldBe "DOWNGRADED"
        capped.interpreter!!.requests shouldBe emptyList()
        capped.usage.llm[acc to today] = AssistantProperties().dailyLlmTurnLimit - 1
        capped.say(s2, "오늘 날씨")
        capped.interpreter.requests.size shouldBe 1
    }

    /**
     * COST-U8-04 — 서비스 전역 월 상한. 계정이 아니라 **전체**가 낮아진다: 한 계정이 하루 상한 안에 있어도, 모두의 이번 달
     * 합이 상한에 닿았으면 해석을 부르지 않는다. 지난달 것은 세지 않고(달이 바뀌면 풀린다), 0 이면 꺼져 있다.
     */
    "이번 달 전역 LLM 상한에 닿으면 모든 계정이 버튼 모드다 — 지난달 것은 세지 않고 0 이면 꺼져 있다" {
        val others = UUID.randomUUID()
        val capped = AssistantProperties(monthlyLlmCallLimit = 100)
        val w = world()
        val s = w.session()

        w.usage.llm[others to today.withDayOfMonth(1)] = 99
        w.usage.llm[others to today.withDayOfMonth(1).minusDays(1)] = 5_000 // 지난달
        w.say(s, "오늘 날씨", service = w.service(properties = capped))
        w.interpreter!!.requests.size shouldBe 1 // 99 < 100 — 아직 부른다(그리고 이 턴은 LLM 0회라 합이 그대로다)

        w.usage.llm[others to today] = 1 // 남의 계정이 채웠다
        w.say(s, "오늘 날씨", service = w.service(properties = capped))
        w.messages.rows.last().saved.outcome shouldBe "DOWNGRADED"
        w.interpreter.requests.size shouldBe 1

        w.say(s, "오늘 날씨") // 상한이 0(기본값)이면 합이 얼마든 부른다
        w.interpreter.requests.size shouldBe 2

        // "이번 달"은 여행지 시각(KST)으로 잰다 — UTC 로는 아직 10월 31일인 11월 1일 01:00 KST 에, 10월 것은 지난달이다
        val newMonth = world()
        newMonth.clock.now = Instant.parse("2026-10-31T16:00:00Z")
        val late = AssistantSession(UUID.randomUUID(), acc, tripId, newMonth.clock.now, newMonth.clock.now, newMonth.clock.now.plusSeconds(3600))
            .also { newMonth.sessions.rows += it }
        newMonth.usage.llm[others to LocalDate.parse("2026-10-31")] = 5_000
        newMonth.say(late, "오늘 날씨", service = newMonth.service(properties = capped))
        newMonth.interpreter!!.requests.size shouldBe 1
    }

    "LLM 을 쓴 해석만 LLM 턴으로 센다" {
        val w = world(interpreter = Interpreter(framed(Intent.GET_WEATHER, llmCalls = 2)))
        val s = w.session()

        w.say(s, "오늘 날씨")

        w.usage.llm[acc to today] shouldBe 1
        w.row(2).saved.llmCalls shouldBe 2
    }

    /** COST-U8-07 · FD §3.1 — 빠른 답은 해석 경계를 부르지 않는다. 말처럼 보이는 시작 버튼도 의도로 곧장 간다. */
    "빠른 답은 해석 없이 답한다 — 검토·능력 보기·다음 장소" {
        val w = world(Intent.GET_NEXT_SLOT)
        val s = w.session()

        val review = w.press(s, "qr-review")
        review.messages[0].text shouldBe "검토해줘"
        w.row(2).saved.intent shouldBe "SHOW_SCHEDULE"
        w.row(2).saved.matchRoute shouldBe "ACTION"

        val capabilities = w.press(s, "qr-capabilities")
        capabilities.messages[1].text shouldBe "이런 걸 도와드릴 수 있어요. ${AssistantTemplates.CAPABILITIES_LINE}"
        capabilities.quickReplies.map { it.id } shouldContainExactly StartQuickReplies.of(true).map { it.id }
        w.interpreter!!.requests shouldBe emptyList()

        w.press(s, "qr-next").messages[1].nextActions.single().type shouldBe "OPEN_LIVE" // 여행 중이다
        w.row(6).saved.intent shouldBe "GET_NEXT_SLOT"
        w.interpreter.requests shouldBe emptyList()
        w.usage.llm[acc to today] shouldBe null
    }

    "[다시 시도]는 직전에 못 알아들은 그 말을 다시 태운다 — 연달아 눌러도 '다시 시도'를 해석하지 않는다" {
        var fail = true
        val w = world(interpreter = Interpreter { r -> if (fail) throw DialogueInterpretFailed("down") else framed(Intent.GET_WEATHER)(r) })
        val s = w.session()
        w.say(s, "오늘 날씨 어때").messages[1].kind shouldBe MessageKind.FALLBACK
        w.press(s, "qr-retry").messages[1].kind shouldBe MessageKind.FALLBACK // 발급된 빠른 답이라 받는다

        fail = false
        val retried = w.press(s, "qr-retry")

        retried.messages[1].nextActions.single().type shouldBe "OPEN_ITINERARY"
        w.interpreter!!.requests.map { it.utterance }.distinct() shouldContainExactly listOf("오늘 날씨 어때")
    }

    "되묻기 — 상대가 준 질문과 보기를 그대로 싣고, 보기를 누르면 그 말이 다음 해석으로 간다" {
        val context = """{"pending":{"asked_argument":"day"},"turn_index":1,"clarify_count":1}"""
        val w = world(interpreter = Interpreter { r ->
            if (r.utterance == "둘째 날") framed(Intent.EDIT_SCHEDULE)(r)
            else Interpretation(
                InterpretOutcome.ARGUMENT_CLARIFY, listOf(IntentFrame(Intent.EDIT_SCHEDULE, emptyMap(), "VOTED")),
                Clarify("day", "몇째 날 일정을 바꿀까요?", listOf("첫째 날", "둘째 날")), context, 0,
            )
        })
        val s = w.session()

        val asked = w.say(s, "카페 바꿔줘")

        asked.messages[1].kind shouldBe MessageKind.CLARIFY
        asked.messages[1].text shouldBe "몇째 날 일정을 바꿀까요?"
        asked.quickReplies.map { it.label } shouldContainExactly listOf("첫째 날", "둘째 날")
        json.readTree(w.sessions.rows.single().dialogueContext) shouldBe json.readTree(context) // 돌려받은 그대로 저장

        w.press(s, asked.quickReplies[1].id).messages[1].nextActions.single().type shouldBe "OPEN_ITINERARY_EDIT"
        val second = w.interpreter!!.requests.last()
        second.utterance shouldBe "둘째 날"
        json.readTree(second.dialogueContext)["pending"]["asked_argument"].asText() shouldBe "day" // 보류 프레임을 그대로 반송
        json.readTree(second.dialogueContext)["turn_index"].asInt() shouldBe 2
    }

    /** 해석이 뽑은 인자가 처리기까지 간다 — 안 가면 "모카 어때"가 늘 "일정에서 확인하세요"로 끝난다. */
    "해석이 뽑은 인자로 일정의 장소를 찾아 답한다" {
        val w = world(interpreter = Interpreter { r ->
            Interpretation(InterpretOutcome.FRAME, listOf(IntentFrame(Intent.GET_DISTANCE, mapOf("destination" to "모카"), "CONFIDENT")), null, r.dialogueContext, 0)
        })
        val s = w.session()

        val card = w.say(s, "모카까지 얼마나 멀어").messages[1]

        card.kind shouldBe MessageKind.INFO
        card.payload!!["title"] shouldBe "카페 모카" // 말한 "모카"가 아니라 저장된 이름
    }

    /** 버튼에는 다시 태울 "말"이 없다 — [다시 시도]를 주면 엉뚱한 옛 문장이 나간다. */
    "버튼을 눌러 온 턴이 실패하면 다시 시도를 주지 않는다 — 말로 온 턴에는 준다" {
        val w = world()
        val s = w.session()
        val throwing = dispatcher(w.data) // 자리만 — 아래에서 원천을 죽인다
        val brokenTrips = object : TripFacade {
            override fun findPeriod(accountId: UUID, tripId: UUID): TripPeriod? = null
            override fun findGenerationContext(accountId: UUID, id: UUID): TripGenerationContext? = throw IllegalStateException("db down")
        }
        val service = AssistantTurnService(
            w.sessions, w.messages, w.usage, AccountTurnLock { }, clean, provider(w.interpreter), throwing,
            TripContextReader(brokenTrips, stays), ContextSnapshotBuilder(TripContextReader(trips, stays), w.data, w.data, AssistantProperties()),
            w.data, w.data, w.memory, AssistantProperties(), json, w.clock, NOOP_TX,
        )

        val pressed = service.send(acc, s.sessionId, UUID.randomUUID(), TurnInput.Action("qr-review"), AssistantSurface.ITINERARY)
        pressed.messages[1].kind shouldBe MessageKind.FALLBACK
        pressed.messages[1].nextActions.map { it.type } shouldContainExactly listOf("CONTINUE_WITHOUT_ASSISTANT")

        val said = service.send(acc, s.sessionId, UUID.randomUUID(), TurnInput.Text("오늘 날씨"), AssistantSurface.ITINERARY)
        said.messages[1].nextActions.map { it.type } shouldContainExactly listOf("RETRY_TURN", "CONTINUE_WITHOUT_ASSISTANT")
    }

    /** DEC-U8-11 · BR-U8-43 — 여러 요청 중 하나를 골라 실행하면 반드시 틀린다. */
    "한 번에 여러 의도가 오면 실행하지 않고 하나씩 말해 달라고 한다" {
        val w = world(interpreter = Interpreter { r ->
            Interpretation(
                InterpretOutcome.FRAME,
                listOf(IntentFrame(Intent.GET_WEATHER, emptyMap(), "LLM_DIRECT"), IntentFrame(Intent.REPLAN, emptyMap(), "LLM_DIRECT")),
                null, r.dialogueContext, 1,
            )
        })
        val s = w.session()

        w.say(s, "날씨 보고 다시 짜줘").messages[1].text shouldBe "한 번에 하나씩 말씀해 주세요."
        w.row(2).saved.intent shouldBe null
    }

    "범위 밖은 거절로 센다 — 이어지면 쓰는 법 안내로 바뀐다" {
        val w = world(Intent.OUT_OF_SCOPE, Interpreter { r ->
            Interpretation(InterpretOutcome.OUT_OF_SCOPE, listOf(IntentFrame(Intent.OUT_OF_SCOPE, emptyMap(), null)), null, r.dialogueContext, 0)
        })
        val s = w.session()

        val first = w.say(s, "항공권 예약해줘")
        first.messages[1].kind shouldBe MessageKind.SCOPE
        first.messages[1].nextActions.map { it.type } shouldContainExactly listOf("SHOW_CAPABILITIES")
        w.sessions.rows.single().refusalStreak shouldBe 1

        w.say(s, "결제해줘").messages[1].kind shouldBe MessageKind.TEXT
    }

    /** BR-U8-05 — 여행이 없다고 막지 않는다. 넘길 화면이 없으니 여행부터 만들게 한다. */
    "여행 없는 대화에서 일정을 물으면 여행 만들기·숙소 검색으로 이끈다" {
        val w = world(Intent.EDIT_SCHEDULE)
        val s = w.session(withTrip = false)

        w.say(s, "카페 바꿔줘").messages[1].nextActions.map { it.type } shouldContainExactly listOf("CREATE_TRIP", "OPEN_STAY_SEARCH")
    }

    /**
     * PBT-U8-2·9 — 어떤 의도·어떤 문맥에서도 처리기가 정확히 하나 골라지고(표가 `when` 이라 빈칸은 컴파일이 잡는다),
     * 그 응답에는 다음 행동이 하나 이상 있으며 전부 앱이 아는 값이다.
     */
    "임의의 의도·문맥에서 응답은 막다르지 않고 다음 행동이 closed-set 안이다" {
        val tripContext = TripContext(listOf("부산"), 1, null, today, today.plusDays(1))
        checkAll(
            Arb.enum<Intent>(), Arb.enum<AssistantSurface>(), Arb.element(true, false), Arb.element(true, false),
            // 일정이 있든 없든, 위반·거리·이름이 있든 없든, 원천이 죽었든 — 어느 조합에서도 같은 성질이다
            Arb.list(Arb.element("카페 모카", "해변", null), 0..4), Arb.element(true, false), Arb.element("해변", "없는 곳", ""),
        ) { intent, surface, hasTrip, inTrip, names, broken, said ->
            val data = FakeTripData(
                acc,
                slots = names.mapIndexed { i, name -> plannedSlot(today, i, "1${i}:00", name, violation = "영업시간과 맞지 않아요".takeIf { i % 2 == 0 }, distance = "1.2km".takeIf { i % 2 == 1 }) },
                hasItinerary = names.isNotEmpty(), reading = WeatherReading(40, "호우주의보", start, stale = false).takeIf { !broken },
            ).apply { failPlan = broken && names.size > 2; failItinerary = broken && names.size % 2 == 0; failWeather = broken }
            val context = DispatchContext(
                acc, tripId.takeIf { hasTrip }, tripContext.takeIf { hasTrip }, hasTrip && inTrip, surface,
                mapOf("destination" to said, "place" to said), start,
            )
            // 처리기는 **던지지 않는다** — 원천이 죽어도 스스로 가용한 답을 낸다. 던지면 이 속성이 깨져 드러난다.
            val message = dispatcher(data).dispatch(intent, context)

            (message.nextActions.isNotEmpty()) shouldBe true
            message.nextActions.forEach { (it.type in NextAction.TYPES) shouldBe true }
            (message.text.orEmpty() + message.payload.toString()).let { said ->
                listOf("분 소요", "duration", "시간 걸").forEach { (it in said) shouldBe false } // INV-3
            }
        }
        // 서비스가 고르는 나머지 문구도 같은 성질을 가진다
        listOf(
            AssistantTemplates.capabilities(true), AssistantTemplates.capabilities(false), AssistantTemplates.needTrip(),
            AssistantTemplates.refusal(null), AssistantTemplates.usageGuide(true, "REFUSAL"), AssistantTemplates.oneAtATime(false),
            AssistantTemplates.buttonMode(true), AssistantTemplates.clarify("day", "몇째 날?", emptyList()), AssistantTemplates.staySearch(),
        ).plus(FallbackCause.entries.flatMap { listOf(AssistantTemplates.fallback(it), AssistantTemplates.fallback(it, retryable = false)) }).forEach { message ->
            (message.nextActions.isNotEmpty()) shouldBe true
            message.nextActions.forEach { (it.type in NextAction.TYPES) shouldBe true }
            (message.text.orEmpty() + message.payload.toString()).let { said ->
                listOf("분 소요", "duration", "시간 걸").forEach { (it in said) shouldBe false }
            }
        }
        shouldThrow<IllegalArgumentException> { Intent.valueOf("DELETE_EVERYTHING") } // 표 밖 값은 만들 수 없다
    }


    // ── ANSWER — 상대(오케스트레이터)가 완성한 답(assistant-orchestrator FD BLM §10). FE 가 받는 모양은 종전 NewMessage 그대로다 ──

    fun answering(
        answer: InterpretedAnswer, frames: List<IntentFrame> = listOf(IntentFrame(Intent.GET_WEATHER, emptyMap(), "LLM_DIRECT")), llmCalls: Int = 2,
    ) = Interpreter { r -> Interpretation(InterpretOutcome.ANSWER, frames, null, r.dialogueContext, llmCalls, answer) }

    val openItinerary = NextAction("OPEN_ITINERARY", "일정 보기")

    "상대가 완성한 답은 그대로 저장되고 빠른 답은 서버가 id 를 발급한다 — 관측 칸은 ANSWER·분류 프레임·LLM 합" {
        val w = world(
            interpreter = answering(
                InterpretedAnswer(
                    AnswerKind.INFO, "오늘 부산은 맑아요.",
                    mapOf("infoKind" to "WEATHER", "title" to "오늘 날씨", "rows" to listOf(mapOf("label" to "강수확률", "value" to "10%"))),
                    listOf(openItinerary),
                    listOf(
                        InterpretedQuickReply("다음 장소", QuickReplyAction.SEND_TEXT, mapOf(StartQuickReplies.INTENT to "GET_NEXT_SLOT")),
                        InterpretedQuickReply("고마워", QuickReplyAction.SEND_TEXT, emptyMap()),
                    ),
                    footnote = "* 기상청 예보 기준",
                ),
            ),
        )
        val s = w.session()

        val result = w.say(s, "오늘 날씨 어때")

        val card = result.messages[1]
        card.kind shouldBe MessageKind.INFO
        card.text shouldBe "오늘 부산은 맑아요."
        card.footnote shouldBe "* 기상청 예보 기준"
        card.payload!!["infoKind"] shouldBe "WEATHER"
        card.nextActions shouldContainExactly listOf(openItinerary)
        // 빠른 답은 서버가 발급한 id 로만 받는다 — 상대가 준 보기에 id 를 붙여 저장하고, 누르면 그 라벨이 다음 턴이 된다
        result.quickReplies.forEach { it.id.matches(Regex("qr-ai-[0-9a-f]{8}-\\d")) shouldBe true }
        result.quickReplies.map { it.label } shouldContainExactly listOf("다음 장소", "고마워")
        val saved = w.row(2).saved
        saved.outcome shouldBe "ANSWER"
        saved.intent shouldBe "GET_WEATHER"
        saved.matchRoute shouldBe "LLM_DIRECT"
        saved.llmCalls shouldBe 2
        w.usage.llm[acc to today] shouldBe 1
        w.sessions.rows.single().refusalStreak shouldBe 0

        // params.intent 가 실린 빠른 답은 해석 없이 곧장 그 의도로 간다(서버 발급 취급 — 상대가 준 값이지만 서버가 id 를 붙여 발급했다)
        w.press(s, result.quickReplies[0].id).messages[1].nextActions.single().type shouldBe "OPEN_LIVE"
        w.row(4).saved.intent shouldBe "GET_NEXT_SLOT"
        w.interpreter!!.requests.size shouldBe 1
        // 라벨만 있는 빠른 답은 그 말을 해석으로 태운다
        w.press(s, result.quickReplies[1].id)
        w.interpreter.requests.last().utterance shouldBe "고마워"
    }

    /** 리터럴 "내가 할 수 있는 것 보기"는 상대가 분류 없이 답한다(BR-AO-18) — 프레임이 없어도 받는다(미결 #19 A). */
    "분류 프레임 없는 ANSWER 도 받는다 — intent 는 비고 match_route 는 NONE, 빠른 답 null 은 시작 칩이다" {
        val w = world(interpreter = answering(InterpretedAnswer(AnswerKind.TEXT, "이런 걸 도와드릴 수 있어요.", null, listOf(openItinerary), null, null), frames = emptyList(), llmCalls = 0))
        val s = w.session()

        val result = w.say(s, "내가 할 수 있는 것 보기")

        result.messages[1].kind shouldBe MessageKind.TEXT
        result.quickReplies.map { it.id } shouldContainExactly StartQuickReplies.of(true).map { it.id }
        w.row(2).saved.intent shouldBe null
        w.row(2).saved.matchRoute shouldBe "NONE"
        w.row(2).saved.outcome shouldBe "ANSWER"
        w.usage.llm[acc to today] shouldBe null
    }

    /** 후보는 지어낼 수 없다(INV-1) — 상대가 준 poiId 를 장소 정본과 대조하고, 이름은 정본값으로 덮는다. */
    "ANSWER 의 후보는 장소 정본에 있는 것만 남고 이름은 정본값이다 — 고르기 버튼은 실재 슬롯·후보에만, 전부 없으면 폴백" {
        val w = world()
        val s = w.session()
        val slot = w.data.slots.single()
        val real = UUID.randomUUID()
        val ghost = UUID.randomUUID()
        w.data.surfaces = mapOf(real to surface(real, "책방카페"))
        fun candidate(id: UUID, name: String) = mapOf("poiId" to id.toString(), "name" to name, "distanceRange" to "600m", "reason" to "조용해요")
        fun pick(id: UUID, slotKey: String) = InterpretedQuickReply("고르기", QuickReplyAction.PICK_CANDIDATE, mapOf("poiId" to id.toString(), "slotKey" to slotKey))
        w.interpreter!!.answer = { r ->
            Interpretation(
                InterpretOutcome.ANSWER, listOf(IntentFrame(Intent.SUGGEST_ALTERNATIVE, emptyMap(), "LLM_DIRECT")), null, r.dialogueContext, 1,
                InterpretedAnswer(
                    AnswerKind.CANDIDATES, "대신 갈 만한 곳이에요.", mapOf("candidates" to listOf(candidate(real, "지어낸 이름"), candidate(ghost, "유령 카페"))),
                    listOf(openItinerary), listOf(pick(real, slot.slotKey), pick(ghost, slot.slotKey), pick(real, "$today#${UUID.randomUUID()}")), null,
                ),
            )
        }

        val result = w.say(s, "카페 대신 갈 곳")

        val card = result.messages[1]
        card.kind shouldBe MessageKind.CANDIDATES
        @Suppress("UNCHECKED_CAST")
        val shown = card.payload!!["candidates"] as List<Map<String, Any?>>
        shown.map { it["poiId"] } shouldContainExactly listOf(real.toString())
        shown.single()["name"] shouldBe "책방카페" // 상대가 쓴 이름이 아니라 정본 이름
        shown.single()["reason"] shouldBe "조용해요"
        // 고르기는 실재 슬롯 × 남은 후보 짝 하나만 — 유령 후보·지어낸 슬롯의 버튼은 발급하지 않는다
        result.quickReplies.map { it.params } shouldContainExactly listOf(mapOf("poiId" to real.toString(), "slotKey" to slot.slotKey))
        // 누르면 그 슬롯을 그 장소로 바꾸는 **제안** 경로다(LLM 0회) — 저장은 [적용]만(BR-U8-30)
        w.editing.proposal = {
            EditProposal.Proposed(listOf(ProposedDay(today, listOf(proposedSlot(slot.poiId, "18:00")))), listOf(ProposedDay(today, listOf(proposedSlot(real, "18:00")))), null)
        }
        w.press(s, result.quickReplies.single().id).messages[1].kind shouldBe MessageKind.PROPOSAL
        w.editing.proposed.single().request shouldBe EditProposalRequest.ReplaceSlot(slot.slotKey, real)
        w.editing.edits shouldBe emptyList()

        // 남는 후보가 없으면 지어내지 않고 폴백한다 — 쓴 LLM 은 센다
        w.data.surfaces = emptyMap()
        val none = w.say(s, "카페 대신 갈 곳")
        none.messages[1].kind shouldBe MessageKind.FALLBACK
        none.messages[1].payload!!["cause"] shouldBe "SOURCE_UNAVAILABLE"
        w.messages.rows.last().saved.llmCalls shouldBe 1
    }

    "ANSWER 인데 답이 없으면 계약이 어긋난 것이다 — 지어내지 않고 폴백하되 쓴 LLM 은 센다" {
        val w = world(interpreter = Interpreter { r -> Interpretation(InterpretOutcome.ANSWER, listOf(IntentFrame(Intent.GET_WEATHER, emptyMap(), "LLM_DIRECT")), null, r.dialogueContext, 1) })
        val s = w.session()

        val card = w.say(s, "오늘 날씨").messages[1]

        card.kind shouldBe MessageKind.FALLBACK
        card.payload!!["cause"] shouldBe "AI_UNAVAILABLE"
        w.usage.llm[acc to today] shouldBe 1
    }

    /** BR-AO-11 — 단기 기억은 백엔드가 싣는다. 가려진 입력은 원문이 없어 빠지고, 이번 발화는 `utterance` 로 가므로 겹쳐 싣지 않는다. */
    "최근 대화는 원문이 있는 메시지만 300자로 줄여 오래된 것부터 싣는다 — 가려진 입력과 이번 발화는 빠지고 20건까지다" {
        val w = world()
        val s = w.session()
        w.say(s, "a".repeat(400)) // 1·2
        w.say(s, "금칙 문장") // 3(가려짐)·4(거절)
        w.press(s, "qr-capabilities") // 5·6

        w.say(s, "오늘 날씨") // 7·8

        val sent = w.interpreter!!.requests.last()
        sent.recentTurns.map { it.role } shouldContainExactly listOf(MessageRole.USER, MessageRole.ASSISTANT, MessageRole.ASSISTANT, MessageRole.USER, MessageRole.ASSISTANT)
        sent.recentTurns.first().text shouldBe "a".repeat(200) + "…" + "a".repeat(99) // 앞과 끝을 남긴다 — clip
        sent.recentTurns.none { "금칙" in it.text } shouldBe true
        sent.recentTurns.none { it.text == "오늘 날씨" } shouldBe true

        repeat(12) { w.clock.now = w.clock.now.plusSeconds(5); w.say(s, "또 날씨") }
        w.say(s, "마지막")
        w.interpreter.requests.last().recentTurns.size shouldBe 20
    }

    /** 답변 0.3.0 은 제안을 맨 끝에 둔다 — 300자를 넘는 답의 앞만 남기면 그 뒤의 "응"이 무엇을 받는지 분류가 못 본다. */
    "긴 최근 턴은 앞 200자와 끝을 남기고 가운데를 줄인다 — 300자 안, 서로게이트 쌍을 가르지 않는다" {
        val long = "가".repeat(300) + " 출발 전에 날씨도 확인해 드릴까요?"
        AssistantTurnService.clip(long).let {
            it.length shouldBe 300
            it.startsWith("가".repeat(200) + "…") shouldBe true
            it.endsWith(" 출발 전에 날씨도 확인해 드릴까요?") shouldBe true
        }
        AssistantTurnService.clip("짧은 답이에요.") shouldBe "짧은 답이에요."
        checkAll(Arb.list(Arb.element("가", "a", " ", "😀"), 0..400).map { it.joinToString("") }) { s ->
            val c = AssistantTurnService.clip(s)
            c.length shouldBeLessThanOrEqual 300
            if (s.length <= 300) {
                c shouldBe s
            } else {
                s.startsWith(c.substringBefore("…")) shouldBe true
                s.endsWith(c.substringAfter("…")) shouldBe true
            }
            c.indices.all { i ->
                (!c[i].isHighSurrogate() || c.getOrNull(i + 1)?.isLowSurrogate() == true) &&
                    (!c[i].isLowSurrogate() || c.getOrNull(i - 1)?.isHighSurrogate() == true)
            } shouldBe true
        }
    }

    /**
     * PBT — 상대가 어떤 모양의 ANSWER 를 보내도(와이어 그대로 → 어댑터 → 턴), 저장되는 응답은 막다르지 않고(다음 행동 ≥1),
     * 전부 앱이 아는 값이며(TYPES · QuickReplyAction), 빠른 답 id 는 서버 발급이고, 소요시간 문구를 **우리가 더하지 않는다**(INV-3 —
     * 상대 게이트가 거른 문장을 그대로 낸다).
     */
    "임의의 와이어 ANSWER 에서 저장되는 응답은 다음 행동 ≥1·closed-set 이고 빠른 답은 서버 발급이며 소요시간 문구가 없다" {
        val boundary = HttpDialogueInterpreter.boundaryMapper()
        val text = Arb.string(1..60, Codepoint.alphanumeric()).filter { it.isNotBlank() }
        val types = Arb.element(NextAction.TYPES.toList() + listOf("OPEN_SETTINGS", "", "DELETE_ALL"))
        val actions = Arb.element(QuickReplyAction.entries.map { it.name } + listOf("TELEPORT", ""))
        checkAll(60, Arb.enum<AnswerKind>(), text, Arb.list(types, 1..4), Arb.list(actions, 0..3), Arb.element(true, false)) { kind, said, typeList, actionList, withFootnote ->
            val w = world()
            val s = w.session()
            val slot = w.data.slots.single()
            val real = UUID.randomUUID()
            w.data.surfaces = mapOf(real to surface(real, "책방카페"))
            val payload = when (kind) {
                AnswerKind.TEXT -> null
                AnswerKind.INFO -> mapOf("infoKind" to "WEATHER", "title" to "날씨", "rows" to listOf(mapOf("label" to "강수", "value" to "10%")))
                AnswerKind.CANDIDATES -> mapOf("candidates" to listOf(mapOf("poiId" to real.toString(), "name" to "x", "reason" to "y")))
            }
            val wire = WireResponse(
                outcome = "ANSWER", frames = listOf(WireFrame("GET_WEATHER", matchRoute = "LLM_DIRECT")),
                answer = WireAnswer(
                    kind.name, said, payload, typeList.map { WireNextAction(it, "라벨") },
                    actionList.map { WireQuickReply("보기", it, if (it == "PICK_CANDIDATE") mapOf("poiId" to real.toString(), "slotKey" to slot.slotKey) else emptyMap()) },
                    footnote = "* 각주".takeIf { withFootnote },
                ),
                dialogueContext = boundary.createObjectNode(), llmCalls = 1,
            )
            w.interpreter!!.answer = { wire.toDomain(boundary) }

            val message = w.say(s, "아무 말").messages[1]

            (message.nextActions.isNotEmpty()) shouldBe true
            message.nextActions.forEach { (it.type in NextAction.TYPES) shouldBe true }
            val replies = message.quickReplies.orEmpty()
            replies.forEach { reply ->
                (reply.action in QuickReplyAction.entries.map { it.name }) shouldBe true
                reply.id.startsWith("qr-ai-") shouldBe true
            }
            replies.map { it.id }.distinct().size shouldBe replies.size
            (message.text.orEmpty() + message.payload.toString()).let { out -> listOf("분 소요", "duration", "시간 걸").forEach { (it in out) shouldBe false } }
            w.row(2).saved.outcome shouldBe "ANSWER"
        }
    }

    /** 제안의 재료 — 오늘 저녁의 카페 모카를 책방카페로 바꾸는 안과, 그 자리의 후보 하나. */
    fun World.offerBookCafe(hint: String? = "AUTO_APPLY"): UUID {
        val book = UUID.randomUUID()
        val moca = data.slots.single()
        data.surfaces = mapOf(book to surface(book, "책방카페"))
        editing.candidates = { SlotCandidatesView(listOf(SlotCandidateView(book, "630m", "조용한 좌석")), degraded = false, emptyReason = null) }
        editing.proposal = {
            EditProposal.Proposed(
                listOf(ProposedDay(today, listOf(proposedSlot(moca.poiId, "18:00", "840m")))), listOf(ProposedDay(today, listOf(proposedSlot(book, "18:00")))), hint,
            )
        }
        return book
    }

    /**
     * 해석이 꺼진 버튼 모드(운영 기본값)에서도 변경 제안까지 간다 — "어느 장소"를 말로 가리킬 수 없으니 버튼이 슬롯을 실어 나른다.
     * 그 사이 **일정은 한 번도 저장되지 않는다**(BR-U8-30).
     */
    "버튼만으로 다음 장소 → 다른 곳 추천 → 고르기 → 제안까지 간다 — 저장은 없다" {
        val w = world(interpreter = null)
        val s = w.session()
        val book = w.offerBookCafe()

        val next = w.press(s, "qr-next")
        next.quickReplies.map { it.label } shouldContainExactly listOf("다른 곳 추천") + StartQuickReplies.of(true).map { it.label }

        val candidates = w.press(s, next.quickReplies.first().id)
        candidates.messages[1].kind shouldBe MessageKind.CANDIDATES
        w.editing.asked shouldContainExactly listOf(w.data.slots.single().slotKey)

        val proposal = w.press(s, candidates.quickReplies.single().id)
        proposal.messages[1].kind shouldBe MessageKind.PROPOSAL
        proposal.messages[1].proposal!!.let { it.status to it.diff.single().change } shouldBe ("PROPOSED" to "REPLACED")
        w.editing.proposed.single().request shouldBe EditProposalRequest.ReplaceSlot(w.data.slots.single().slotKey, book)
        (w.editing.proposed.single().deadlineMs in 1..AssistantProperties().editStageMaxMs) shouldBe true
        proposal.quickReplies.map { it.id } shouldContainExactly StartQuickReplies.of(true).map { it.id } // 제안 뒤에는 시작 빠른 답으로
        w.messages.proposals.rows.size shouldBe 1
        w.editing.edits shouldBe emptyList()
        w.usage.llm[acc to today] shouldBe null // 버튼만 눌렀다 — LLM 0회
    }

    /** 턴 예산이 다 됐으면 상대를 부르지 않는다 — 부르면 앱의 대기(15초)를 넘긴다(PERF-U8-01). */
    "남은 턴 예산만큼만 편집 제안에 준다" {
        val w = world(Intent.EDIT_SCHEDULE)
        val s = w.session()
        w.offerBookCafe()
        w.interpreter!!.answer = { r ->
            w.clock.now = w.clock.now.plusMillis(9_000) // 해석이 9초를 썼다
            framed(Intent.EDIT_SCHEDULE)(r)
        }

        w.say(s, "카페 바꿔줘")

        w.editing.proposed.single().deadlineMs shouldBe 13_000 - 9_000 - 1_000
    }

    /**
     * 발화 편집은 상대가 LLM 으로 옮긴다 — 해석이 LLM 을 안 썼어도 그 턴은 LLM 턴이다(COST-U8-02).
     * 그리고 상대가 돌려준 인자에 **서버 발급 전용 키**가 있어도 쓰지 않는다 — 지어낸 슬롯·장소로 교체가 나가면 안 된다.
     */
    "말로 바꾸라고 하면 LLM 턴으로 세고, 상대가 지어낸 슬롯·장소 인자는 버린다" {
        val forged = mapOf("slotKey" to "$today#${UUID.randomUUID()}", "poiId" to UUID.randomUUID().toString())
        val w = world(interpreter = Interpreter { r ->
            Interpretation(InterpretOutcome.FRAME, listOf(IntentFrame(Intent.EDIT_SCHEDULE, forged, "CONFIDENT")), null, r.dialogueContext, 0)
        })
        val s = w.session()
        w.offerBookCafe()

        val result = w.say(s, "카페 바꿔줘")

        result.messages[1].kind shouldBe MessageKind.PROPOSAL
        w.editing.proposed.single().request shouldBe EditProposalRequest.Utterance("카페 바꿔줘")
        w.row(2).saved.llmCalls shouldBe 1
        w.usage.llm[acc to today] shouldBe 1
    }

    /**
     * PBT-U8-1 ★ — **단독 확정 없음.** 말·버튼·상대의 답(`AUTO_APPLY` 포함)이 어떻게 섞여도, [적용]을 누르지 않는 한
     * 일정 저장은 0번이다. 턴 서비스에는 저장으로 가는 길이 아예 없어야 한다.
     */
    "임의의 턴 열에서 적용 없이는 일정이 저장되지 않는다" {
        checkAll(
            Arb.list(Arb.element("SAY_EDIT", "SAY_ALTERNATIVE", "NEXT", "ALTERNATIVE", "PICK", "REVIEW"), 1..8),
            Arb.element("AUTO_APPLY", "CONFIRM_REQUIRED", null), Arb.element("PROPOSED", "REJECTED", "UNAVAILABLE"),
        ) { steps, hint, kind ->
            val w = world(interpreter = Interpreter { r ->
                val (intent, arguments) = if ("대신" in r.utterance) Intent.SUGGEST_ALTERNATIVE to mapOf("target" to "카페") else Intent.EDIT_SCHEDULE to emptyMap()
                Interpretation(InterpretOutcome.FRAME, listOf(IntentFrame(intent, arguments, "CONFIDENT")), null, r.dialogueContext, 1)
            })
            val s = w.session()
            w.offerBookCafe(hint)
            when (kind) {
                "REJECTED" -> w.editing.proposal = { EditProposal.Rejected(listOf(ProposalViolation(null, today, "영업시간과 맞지 않아요"))) }
                "UNAVAILABLE" -> w.editing.proposal = { EditProposal.Unavailable }
            }
            val issued = mutableMapOf<String, String>() // 종류 → 가장 최근에 발급된 버튼 id
            steps.forEach { step ->
                val result = when (step) {
                    "SAY_EDIT" -> w.say(s, "카페 바꿔줘")
                    "SAY_ALTERNATIVE" -> w.say(s, "카페 대신 갈 곳")
                    "NEXT" -> w.press(s, "qr-next")
                    "REVIEW" -> w.press(s, "qr-review")
                    "ALTERNATIVE" -> issued["ALT"]?.let { w.press(s, it) }
                    else -> issued["PICK"]?.let { w.press(s, it) }
                }
                result?.quickReplies?.forEach { reply ->
                    if (reply.id.startsWith("qr-alt-")) issued["ALT"] = reply.id
                    if (reply.action == "PICK_CANDIDATE") issued["PICK"] = reply.id
                }
                result?.messages?.drop(1)?.forEach { (it.nextActions.isNotEmpty()) shouldBe true }
            }
            w.editing.edits shouldBe emptyList()
        }
    }

    /**
     * PBT-U8-7 — 맥락은 상대의 것이다. 순번 하나만 올리고 나머지는 **뜻이 같은 채로** 반송한다(INV-U8-07).
     * (jsonb 가 키 순서와 공백을 고쳐 저장하므로 바이트가 아니라 JSON 값으로 견준다.)
     */
    "임의의 대화 맥락에서 순번만 하나 오르고 나머지는 그대로다" {
        val w = world()
        val service = w.service()
        checkAll(Arb.map(Arb.string(1..8), Arb.string(0..12), maxSize = 6), Arb.int(0..500)) { extra, turnIndex ->
            val original = json.createObjectNode().apply {
                extra.forEach { (k, v) -> put("x_$k", v) }
                // 숫자가 왕복에서 갈리기 쉬운 자리다 — 소수·큰 정수·음수를 섞는다
                put("confidence", 0.93).put("big", 9_007_199_254_740_993L).put("negative", -turnIndex)
                putObject("pending").put("asked", "몇째 날?").putArray("missing").add("day")
                put("turn_index", turnIndex)
                put("clarify_count", 1)
            }

            val bumped = json.readTree(service.bumpTurnIndex(json.writeValueAsString(original)))

            bumped["turn_index"].asInt() shouldBe turnIndex + 1
            (bumped as com.fasterxml.jackson.databind.node.ObjectNode).put("turn_index", turnIndex)
            bumped shouldBe original
        }
        // 맥락이 아직 없어도 **만들지 않는다** — 순번만 간다. 나머지 칸의 기본값은 상대가 정한다
        json.readTree(service.bumpTurnIndex("{}")) shouldBe json.readTree("""{"turn_index":1}""")
    }
})
