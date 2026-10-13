package com.trippilot.assistant.application

import com.fasterxml.jackson.databind.ObjectMapper
import com.trippilot.assistant.domain.AccountTurnLock
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
import com.trippilot.assistant.domain.MessageKind
import com.trippilot.assistant.domain.MessageRole
import com.trippilot.assistant.domain.NextAction
import com.trippilot.core.error.RateLimited
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
import io.kotest.assertions.throwables.shouldThrow
import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.collections.shouldContainExactly
import io.kotest.matchers.ints.shouldBeLessThanOrEqual
import io.kotest.matchers.shouldBe
import io.kotest.property.Arb
import io.kotest.property.arbitrary.element
import io.kotest.property.arbitrary.enum
import io.kotest.property.arbitrary.int
import io.kotest.property.arbitrary.list
import io.kotest.property.arbitrary.map
import io.kotest.property.arbitrary.string
import io.kotest.property.checkAll
import org.springframework.beans.factory.ObjectProvider
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
        val messages: FakeMessages = FakeMessages(),
        val usage: FakeUsage = FakeUsage(),
        val clock: MovingClock,
        val interpreter: Interpreter?,
    )

    fun world(
        intent: Intent = Intent.GET_WEATHER,
        interpreter: Interpreter? = Interpreter(framed(intent)),
    ) = World(clock = MovingClock(start), interpreter = interpreter)

    fun World.service(
        moderation: TextModerationFacade = clean,
        properties: AssistantProperties = AssistantProperties(),
    ) = AssistantTurnService(
        sessions, messages, usage, AccountTurnLock { }, moderation, provider(interpreter), IntentDispatcher(),
        TripContextReader(trips, stays), properties, json, clock, NOOP_TX,
    )

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
        json.readTree(sent.dialogueContext)["turn_index"].asInt() shouldBe 1

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

    /** 사용자 행만 남고 응답 저장이 실패한 턴 — 재전송은 사용자 행을 다시 만들지 않고 이어서 답한다. */
    "응답 없이 끊긴 턴을 다시 보내면 사용자 행은 그대로 두고 답만 채운다" {
        val w = world()
        val s = w.session()
        val turn = UUID.randomUUID()
        w.messages.appendUser(s.sessionId, acc, turn, com.trippilot.assistant.domain.NewMessage(MessageRole.USER, MessageKind.TEXT, "오늘 날씨"), start)

        val result = w.say(s, "오늘 날씨", turn)

        result.messages.map { it.role } shouldContainExactly listOf(MessageRole.USER, MessageRole.ASSISTANT)
        w.messages.rows.size shouldBe 2
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
    "같은 턴이 겹쳐 처리돼도 응답은 하나고 사용량도 한 번이다" {
        val turn = UUID.randomUUID()
        lateinit var w: World
        lateinit var s: AssistantSession
        var inner: TurnResult? = null
        w = world(interpreter = Interpreter { r ->
            // 첫 처리가 해석 중일 때 같은 턴이 다시 들어와 먼저 끝난다
            if (inner == null) {
                inner = TurnResult(emptyList(), emptyList())
                inner = w.say(s, "오늘 날씨", turn)
            }
            framed(Intent.GET_WEATHER)(r)
        })
        s = w.session()

        val outer = w.say(s, "오늘 날씨", turn)

        outer.messages.map { it.messageId } shouldContainExactly inner!!.messages.map { it.messageId }
        w.messages.rows.map { it.message.role } shouldContainExactly listOf(MessageRole.USER, MessageRole.ASSISTANT)
        w.usage.turns[acc to today] shouldBe 1
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
        capped.usage.llm[acc to today] = 30
        capped.say(s2, "오늘 날씨")
        capped.row(2).saved.outcome shouldBe "DOWNGRADED"
        capped.interpreter!!.requests shouldBe emptyList()
        capped.usage.llm[acc to today] = 29
        capped.say(s2, "오늘 날씨")
        capped.interpreter.requests.size shouldBe 1
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
        val dispatcher = IntentDispatcher()
        checkAll(Arb.enum<Intent>(), Arb.enum<AssistantSurface>(), Arb.element(true, false), Arb.element(true, false)) { intent, surface, hasTrip, inTrip ->
            val message = dispatcher.dispatch(intent, DispatchContext(hasTrip, hasTrip && inTrip, surface))

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
