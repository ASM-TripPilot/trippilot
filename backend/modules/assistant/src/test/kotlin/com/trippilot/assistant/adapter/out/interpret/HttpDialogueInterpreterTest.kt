package com.trippilot.assistant.adapter.out.interpret

import com.trippilot.assistant.application.AssistantConfiguration
import com.trippilot.assistant.domain.AnswerKind
import com.trippilot.assistant.domain.AssistantSurface
import com.trippilot.assistant.domain.ContextSnapshot
import com.trippilot.assistant.domain.DialogueInterpretFailed
import com.trippilot.assistant.domain.DialogueMemoryPort
import com.trippilot.assistant.domain.Intent
import com.trippilot.assistant.domain.InterpretOutcome
import com.trippilot.assistant.domain.InterpretRequest
import com.trippilot.assistant.domain.InterpretedQuickReply
import com.trippilot.assistant.domain.MessageRole
import com.trippilot.assistant.domain.QuickReplyAction
import com.trippilot.assistant.domain.RecentTurn
import io.kotest.assertions.throwables.shouldThrow
import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.collections.shouldBeEmpty
import io.kotest.matchers.collections.shouldContainAll
import io.kotest.matchers.collections.shouldContainExactly
import io.kotest.matchers.shouldBe
import org.springframework.boot.test.context.runner.ApplicationContextRunner
import org.springframework.http.HttpMethod
import org.springframework.http.MediaType
import org.springframework.http.converter.json.JacksonJsonHttpMessageConverter
import org.springframework.test.web.client.MockRestServiceServer
import org.springframework.test.web.client.match.MockRestRequestMatchers.jsonPath
import org.springframework.test.web.client.match.MockRestRequestMatchers.method
import org.springframework.test.web.client.match.MockRestRequestMatchers.requestTo
import org.springframework.test.web.client.response.MockRestResponseCreators.withServerError
import org.springframework.test.web.client.response.MockRestResponseCreators.withSuccess
import org.springframework.web.client.RestClient
import org.springframework.web.client.RestClientException
import tools.jackson.databind.JsonNode
import java.io.File
import java.time.Instant
import java.time.LocalDate
import java.time.LocalTime
import java.util.UUID

/**
 * 해석 경계 실 어댑터(TRIP-1410 · assistant-orchestrator 1단계). 실 왕복 대신 재는 것 넷:
 * - 우리가 싣는 와이어가 **상대 계약 파일**(`ai/docs/openapi.json`)과 같은 이름인가 — 상대 CI 가 그 파일을 실행 앱과 대조한다
 * - 받은 것을 도메인으로 옮길 때 계약 위반을 [DialogueInterpretFailed] 하나로 올리는가(일정 폴백 신호로 쓰지 않는다, BR-U8-45)
 * - `dialogue_context` 를 읽지 않고 그대로 왕복하는가(INV-U8-07)
 * - 상대가 완성한 답(`ANSWER`)을 **다시 검증**하는가 — 길이·행동 집합·빠른 답 어휘(BLM §10)
 */
class HttpDialogueInterpreterTest : StringSpec({

    val mapper = HttpDialogueInterpreter.boundaryMapper()

    fun builder() = RestClient.builder().baseUrl("http://ai").messageConverters { it.add(0, JacksonJsonHttpMessageConverter(mapper)) }

    fun server(): Pair<MockRestServiceServer, HttpDialogueInterpreter> {
        val builder = builder()
        val server = MockRestServiceServer.bindTo(builder).build()
        return server to HttpDialogueInterpreter(builder.build(), mapper)
    }

    fun memory(): Pair<MockRestServiceServer, HttpDialogueMemoryClient> {
        val builder = builder()
        val server = MockRestServiceServer.bindTo(builder).build()
        return server to HttpDialogueMemoryClient(builder.build())
    }

    val tripId = UUID.fromString("00000000-0000-0000-0000-000000000001")
    val sessionId = UUID.fromString("00000000-0000-0000-0000-00000000000a")
    val request = InterpretRequest(
        utterance = "거리 얼마나 돼?",
        surface = AssistantSurface.ITINERARY,
        context = ContextSnapshot(
            surface = AssistantSurface.ITINERARY,
            trip = ContextSnapshot.TripBlock(tripId, listOf("부산"), LocalDate.of(2026, 11, 1), LocalDate.of(2026, 11, 3), "PLANNING"),
            baseStays = listOf("서면 호텔"),
            itinerary = ContextSnapshot.ItineraryBlock(
                "PLANNED",
                listOf(ContextSnapshot.DayBlock(LocalDate.of(2026, 11, 2), listOf(ContextSnapshot.SlotBlock("2026-11-02#p1", "카페 모카", LocalTime.of(14, 0), "CAFE")))),
            ),
        ),
        dialogueContext = """{"pending":null,"turn_index":4,"clarify_count":0}""",
        requestedAt = Instant.parse("2026-10-14T03:00:00Z"),
        deadlineMs = 5000,
        sessionId = sessionId,
        accountRef = "acc-1",
        recentTurns = listOf(RecentTurn(MessageRole.USER, "오늘 날씨"), RecentTurn(MessageRole.ASSISTANT, "맑아요.")),
        traceId = "7c9e6679-7425-40de-944b-e07fc1f90ae7",
    )

    fun ok(body: String) = withSuccess(body.trimIndent(), MediaType.APPLICATION_JSON)

    "되묻기 응답을 도메인으로 옮기고 맥락은 그대로 돌려받는다 — 세션·계정·최근 대화가 함께 간다" {
        val (server, adapter) = server()
        server.expect(requestTo("http://ai/ai/v1/dialogue/interpret")).andExpect(method(HttpMethod.POST))
            .andExpect(jsonPath("$.utterance").value("거리 얼마나 돼?"))
            .andExpect(jsonPath("$.dialogue_context.turn_index").value(4))
            .andExpect(jsonPath("$.context.surface").value("ITINERARY"))
            .andExpect(jsonPath("$.context.itinerary.days[0].slots[0].slot_key").value("2026-11-02#p1"))
            .andExpect(jsonPath("$.request_meta.deadline_ms").value(5000))
            // 추적 번호는 호출자가 만든 값 그대로 — 상대가 이것을 trace_id 로 로그에 남기고, 우리는 같은 값을 도우미 행에 적는다(BR-U8-64)
            .andExpect(jsonPath("$.request_meta.request_id").value("7c9e6679-7425-40de-944b-e07fc1f90ae7"))
            .andExpect(jsonPath("$.session_id").value(sessionId.toString()))
            .andExpect(jsonPath("$.account_ref").value("acc-1"))
            .andExpect(jsonPath("$.recent_turns[0].role").value("USER"))
            .andExpect(jsonPath("$.recent_turns[1].text").value("맑아요."))
            .andRespond(
                ok(
                    """
                    {"outcome":"ARGUMENT_CLARIFY",
                     "frames":[{"intent":"GET_DISTANCE","arguments":{},"missing":["destination"],"confidence":0.95,"match_route":"CONFIDENT"}],
                     "clarify":{"frame_index":0,"argument":"destination","question":"어디까지의 거리를 알려 드릴까요?",
                                "options":["카페 모카","","${"가".repeat(31)}","해운대","광안리","자갈치","송정"]},
                     "dialogue_context":{"pending":{"intent":"GET_DISTANCE","arguments":{},"asked":"destination","confidence":0.95},"turn_index":4,"clarify_count":1},
                     "llm_calls":0}
                    """,
                ),
            )

        val result = adapter.interpret(request)

        server.verify()
        result.outcome shouldBe InterpretOutcome.ARGUMENT_CLARIFY
        result.frames.single().intent shouldBe Intent.GET_DISTANCE
        result.clarify!!.argument shouldBe "destination"
        // 빈 것·긴 것은 버리고 상한까지만 싣는다 — 받은 그대로 칩으로 그리지 않는다
        result.clarify!!.options shouldBe listOf("카페 모카", "해운대", "광안리", "자갈치")
        mapper.readTree(result.dialogueContext)["pending"]["asked"].asString() shouldBe "destination"
        result.llmCalls shouldBe 0
        result.answer shouldBe null
    }

    "상대 5xx 는 해석 실패 하나로 올린다 — 일정 폴백 신호가 아니다" {
        val (server, adapter) = server()
        server.expect(requestTo("http://ai/ai/v1/dialogue/interpret")).andRespond(withServerError())
        shouldThrow<DialogueInterpretFailed> { adapter.interpret(request) }
    }

    "표 밖 의도·빠진 llm_calls·빠진 맥락은 계약 위반이다" {
        listOf(
            """{"outcome":"FRAME","frames":[{"intent":"HACK","confidence":1}],"dialogue_context":{},"llm_calls":0}""",
            """{"outcome":"FRAME","frames":[{"intent":"GET_WEATHER","confidence":1}],"dialogue_context":{}}""",
            """{"outcome":"FRAME","frames":[{"intent":"GET_WEATHER","confidence":1}],"llm_calls":1}""",
        ).forEach { body ->
            val (server, adapter) = server()
            server.expect(requestTo("http://ai/ai/v1/dialogue/interpret")).andRespond(ok(body))
            shouldThrow<DialogueInterpretFailed> { adapter.interpret(request) }
        }
    }

    // ── ANSWER — 상대가 완성한 답을 다시 검증한다(BLM §10) ──

    val answered = """
        {"outcome":"ANSWER",
         "frames":[{"intent":"GET_WEATHER","arguments":{},"missing":[],"confidence":0.9,"match_route":"LLM_DIRECT"}],
         "answer":{"kind":"INFO","text":"오늘 부산은 맑아요.","payload":{"infoKind":"WEATHER","title":"오늘 날씨","rows":[{"label":"강수확률","value":"10%"}]},
                   "next_actions":[{"type":"OPEN_ITINERARY","label":"일정 보기"},{"type":"OPEN_SETTINGS","label":"설정 열기","params":{"x":"1"}}],
                   "quick_replies":[{"label":"다음 장소","action":"SEND_TEXT","params":{"intent":"GET_NEXT_SLOT"}},{"label":"뭐든","action":"TELEPORT","params":{}}],
                   "footnote":"* 기상청 예보 기준"},
         "dialogue_context":{"turn_index":4},
         "llm_calls":2}
    """

    "ANSWER 는 문장·카드·행동을 도메인으로 옮긴다 — 표 밖 행동은 능력 보기로 바꾸고 모르는 빠른 답은 버린다" {
        val (server, adapter) = server()
        server.expect(requestTo("http://ai/ai/v1/dialogue/interpret")).andRespond(ok(answered))

        val result = adapter.interpret(request)

        result.outcome shouldBe InterpretOutcome.ANSWER
        result.llmCalls shouldBe 2
        val answer = result.answer!!
        answer.kind shouldBe AnswerKind.INFO
        answer.text shouldBe "오늘 부산은 맑아요."
        answer.footnote shouldBe "* 기상청 예보 기준"
        answer.payload!!["infoKind"] shouldBe "WEATHER"
        ((answer.payload!!["rows"] as List<*>).single() as Map<*, *>)["value"] shouldBe "10%"
        // 앱이 모르는 행동은 그리지 못한다 — 막다른 버튼 대신 "내가 할 수 있는 것 보기"로 바꾼다(앱 규칙과 같게)
        answer.nextActions.map { it.type } shouldContainExactly listOf("OPEN_ITINERARY", "SHOW_CAPABILITIES")
        answer.nextActions.last().params shouldBe emptyMap()
        // 어휘 밖 action 의 빠른 답은 서버가 발급할 수 없다 — 버린다
        answer.quickReplies!!.map { it.action } shouldContainExactly listOf(QuickReplyAction.SEND_TEXT)
        answer.quickReplies!!.single().params shouldBe mapOf("intent" to "GET_NEXT_SLOT")
    }

    "ANSWER 의 빠른 답이 없으면 null(시작 칩) · 비면 빈 목록 그대로다" {
        listOf(
            """"quick_replies":null""" to null,
            """"quick_replies":[]""" to emptyList<InterpretedQuickReply>(),
        ).forEach { (field, expected) ->
            val (server, adapter) = server()
            val body = """{"outcome":"ANSWER","frames":[],"answer":{"kind":"TEXT","text":"네.","next_actions":[{"type":"OPEN_ITINERARY","label":"일정"}],$field},"dialogue_context":{},"llm_calls":1}"""
            server.expect(requestTo("http://ai/ai/v1/dialogue/interpret")).andRespond(ok(body))
            adapter.interpret(request).answer!!.quickReplies shouldBe expected
        }
    }

    /** 턴은 폴백 메시지 한 건으로 끝난다(BR-U8-40) — 상대의 문장을 잘라서 내거나 행동 없이 내지 않는다. */
    "ANSWER 계약 위반은 해석 실패다 — answer 없음·빈 문장·2000자 초과·행동 없음·모르는 kind" {
        fun body(answer: String) = """{"outcome":"ANSWER","frames":[],"answer":$answer,"dialogue_context":{},"llm_calls":1}"""
        val action = """[{"type":"OPEN_ITINERARY","label":"일정 보기"}]"""
        listOf(
            body("null"),
            body("""{"kind":"TEXT","text":"   ","next_actions":$action}"""),
            body("""{"kind":"TEXT","text":"${"가".repeat(HttpDialogueInterpreter.MAX_ANSWER_CHARS + 1)}","next_actions":$action}"""),
            body("""{"kind":"TEXT","text":"네.","next_actions":[]}"""),
            body("""{"kind":"PROPOSAL","text":"네.","next_actions":$action}"""),
        ).forEach { b ->
            val (server, adapter) = server()
            server.expect(requestTo("http://ai/ai/v1/dialogue/interpret")).andRespond(ok(b))
            shouldThrow<DialogueInterpretFailed> { adapter.interpret(request) }
        }
        // 딱 상한까지는 받는다 — DB CHECK(≤2000)와 같은 값
        val (server, adapter) = server()
        server.expect(requestTo("http://ai/ai/v1/dialogue/interpret"))
            .andRespond(ok(body("""{"kind":"TEXT","text":"${"가".repeat(HttpDialogueInterpreter.MAX_ANSWER_CHARS)}","next_actions":$action}""")))
        adapter.interpret(request).answer!!.text.length shouldBe HttpDialogueInterpreter.MAX_ANSWER_CHARS
    }

    // ── 메모리 경계 — 파기 3호출 + 내보내기(DE §3.3) ──

    "메모리 파기는 쿼리 하나로 DELETE 하고 지운 수를 돌려받는다 — 0 도 성공이다" {
        val (server, client) = memory()
        server.expect(requestTo("http://ai/ai/v1/dialogue/memory?session_id=$sessionId")).andExpect(method(HttpMethod.DELETE)).andRespond(ok("""{"deleted":1}"""))
        server.expect(requestTo("http://ai/ai/v1/dialogue/memory?trip_id=$tripId")).andExpect(method(HttpMethod.DELETE)).andRespond(ok("""{"deleted":0}"""))
        server.expect(requestTo("http://ai/ai/v1/dialogue/memory?account_ref=acc-1")).andExpect(method(HttpMethod.DELETE)).andRespond(ok("""{"deleted":3}"""))

        client.deleteBySession(sessionId) shouldBe 1
        client.deleteByTrip(tripId) shouldBe 0
        client.deleteByAccount("acc-1") shouldBe 3
        server.verify()
    }

    "메모리 파기 실패는 예외로 올라간다 — 호출측이 WARN 으로 접거나(이력·여행) 재시도한다(계정)" {
        val (server, client) = memory()
        server.expect(requestTo("http://ai/ai/v1/dialogue/memory?account_ref=acc-1")).andRespond(withServerError())
        shouldThrow<RestClientException> { client.deleteByAccount("acc-1") }
    }

    "메모리 내보내기는 GET 으로 요약 줄을 받는다" {
        val (server, client) = memory()
        server.expect(requestTo("http://ai/ai/v1/dialogue/memory?account_ref=acc-1")).andExpect(method(HttpMethod.GET)).andRespond(
            ok(
                """
                {"memories":[{"session_id":"$sessionId","trip_id":"$tripId","summary":["조용한 카페를 좋아한다","둘째 날 저녁은 비웠다"],
                              "summarized_turn_index":12,"updated_at":"2026-10-17T03:00:00Z","expires_at":"2027-01-15T03:00:00Z"},
                             {"session_id":"00000000-0000-0000-0000-00000000000b","trip_id":null,"summary":[],
                              "summarized_turn_index":0,"updated_at":"2026-10-17T04:00:00Z","expires_at":"2027-01-15T04:00:00Z"}]}
                """,
            ),
        )

        val items = client.export("acc-1")

        items.map { it.sessionId } shouldContainExactly listOf(sessionId.toString(), "00000000-0000-0000-0000-00000000000b")
        items[0].tripId shouldBe tripId.toString()
        items[0].summary shouldContainExactly listOf("조용한 카페를 좋아한다", "둘째 날 저녁은 비웠다")
        items[0].updatedAt shouldBe Instant.parse("2026-10-17T03:00:00Z")
        items[1].tripId shouldBe null
    }

    // ── 배선 — 메모리 클라이언트는 해석 모드와 따로 간다: 상대가 없는 fake 만 no-op ──

    "메모리 클라이언트는 http·off 에서 실 클라이언트이고 fake 만 no-op 이다 — off 동안에도 파기가 상대 DB 에 닿는다" {
        val runner = ApplicationContextRunner().withUserConfiguration(AssistantConfiguration::class.java, HttpDialogueInterpreterConfiguration::class.java)
        listOf("http", "off").forEach { mode ->
            runner.withPropertyValues("trippilot.assistant.interpret.mode=$mode").run { context ->
                context.startupFailure shouldBe null
                (context.getBean(DialogueMemoryPort::class.java) is HttpDialogueMemoryClient) shouldBe true
            }
        }
        runner.withPropertyValues("trippilot.assistant.interpret.mode=fake").run { context ->
            context.startupFailure shouldBe null
            context.getBean(DialogueMemoryPort::class.java) shouldBe NoopDialogueMemory
        }
        NoopDialogueMemory.deleteBySession(sessionId) shouldBe 0
        NoopDialogueMemory.export("acc-1") shouldBe emptyList()
    }

    // ── 상대 계약 파일과 이름 대조 (AiBoundaryOpenApiTest 와 같은 방식) ──

    val contract: JsonNode = mapper.readTree(aiContractFile())
    val schemas: JsonNode = contract["components"]["schemas"]

    fun props(name: String): Set<String> = schemas[name]["properties"].propertyNames().toSet()
    fun required(name: String): Set<String> = schemas[name]["required"]?.values()?.map { it.asString() }?.toSet().orEmpty()
    fun keys(node: JsonNode): Set<String> = node.propertyNames().toSet()

    "요청 와이어 이름이 상대 계약과 같다" {
        val wire = mapper.readTree(mapper.writeValueAsString(request.toWire(mapper)))
        val checks = listOf(
            wire to "DialogueInterpretRequest",
            wire["request_meta"] to "RequestMetaSchema",
            wire["context"] to "DialogueContextSnapshot",
            wire["context"]["trip"] to "DialogueTripSchema",
            wire["context"]["itinerary"] to "DialogueItinerarySchema",
            wire["context"]["itinerary"]["days"][0] to "DialogueDaySchema",
            wire["context"]["itinerary"]["days"][0]["slots"][0] to "DialogueSlotSchema",
            wire["recent_turns"][0] to "DialogueTurnSchema",
        )
        checks.forEach { (node, schema) ->
            (keys(node) - props(schema)).shouldBeEmpty()       // 상대가 모르는 키(extra=forbid → 422)
            (required(schema) - keys(node)).shouldBeEmpty()    // 상대가 요구하는데 안 싣는 키
        }
    }

    "응답 와이어 이름이 상대 계약과 같다" {
        props("DialogueInterpretResponse") shouldBe setOf("outcome", "frames", "clarify", "dialogue_context", "llm_calls", "answer")
        props("DialogueFrameSchema") shouldBe setOf("intent", "arguments", "missing", "confidence", "match_route")
        props("DialogueClarifySchema") shouldBe setOf("frame_index", "argument", "question", "options")
        props("DialogueAnswerSchema") shouldBe setOf("kind", "text", "payload", "next_actions", "quick_replies", "footnote")
        props("DialogueNextActionSchema") shouldBe setOf("type", "label", "params")
        props("DialogueQuickReplySchema") shouldBe setOf("label", "action", "params")
        // 상대 enum 과 우리 enum 이 같은 어휘다 — 한쪽이 늘면 여기서 드러난다
        schemas["DialogueAnswerSchema"]["properties"]["kind"]["enum"].map { it.asString() }.toSet() shouldBe AnswerKind.entries.map { it.name }.toSet()
        schemas["DialogueTurnSchema"]["properties"]["role"]["enum"].map { it.asString() }.toSet() shouldBe MessageRole.entries.map { it.name }.toSet()
    }

    "우리가 부르는 대화 경로가 전부 계약에 실재한다 — 메모리는 DELETE·GET 과 쿼리 이름까지" {
        val paths = contract["paths"]
        HttpDialogueInterpreter.DIALOGUE_PATHS.forEach { (paths.has(it)) shouldBe true }
        val memory = paths[HttpDialogueInterpreter.MEMORY_PATH]
        memory["delete"]["parameters"].map { it["name"].asString() } shouldContainAll listOf("session_id", "trip_id", "account_ref")
        memory["get"]["parameters"].map { it["name"].asString() } shouldContainAll listOf("account_ref")
        props("DialogueMemoryDeleteResponse") shouldBe setOf("deleted")
        props("DialogueMemoryExportResponse") shouldBe setOf("memories")
        props("DialogueMemoryItemSchema") shouldBe setOf("session_id", "trip_id", "summary", "summarized_turn_index", "updated_at", "expires_at")
    }
})

private fun aiContractFile(): File {
    var dir: File? = File(System.getProperty("user.dir")).absoluteFile
    while (dir != null) {
        val candidate = File(dir, "ai/docs/openapi.json")
        if (candidate.isFile) return candidate
        dir = dir.parentFile
    }
    error("AI 계약 파일(ai/docs/openapi.json)을 찾지 못했습니다. user.dir=${System.getProperty("user.dir")}")
}

private fun JsonNode.propertyNames(): List<String> = properties().map { it.key }
