package com.trippilot.assistant.adapter.out.interpret

import com.trippilot.assistant.domain.AssistantSurface
import com.trippilot.assistant.domain.ContextSnapshot
import com.trippilot.assistant.domain.DialogueInterpretFailed
import com.trippilot.assistant.domain.Intent
import com.trippilot.assistant.domain.InterpretOutcome
import com.trippilot.assistant.domain.InterpretRequest
import io.kotest.assertions.throwables.shouldThrow
import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.collections.shouldBeEmpty
import io.kotest.matchers.shouldBe
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
import tools.jackson.databind.JsonNode
import java.io.File
import java.time.Instant
import java.time.LocalDate
import java.time.LocalTime
import java.util.UUID

/**
 * 해석 경계 실 어댑터(TRIP-1410). 실 왕복 대신 재는 것 셋:
 * - 우리가 싣는 와이어가 **상대 계약 파일**(`ai/docs/openapi.json`)과 같은 이름인가 — 상대 CI 가 그 파일을 실행 앱과 대조한다
 * - 받은 것을 도메인으로 옮길 때 계약 위반을 [DialogueInterpretFailed] 하나로 올리는가(일정 폴백 신호로 쓰지 않는다, BR-U8-45)
 * - `dialogue_context` 를 읽지 않고 그대로 왕복하는가(INV-U8-07)
 */
class HttpDialogueInterpreterTest : StringSpec({

    val mapper = HttpDialogueInterpreter.boundaryMapper()

    fun server(): Pair<MockRestServiceServer, HttpDialogueInterpreter> {
        val builder = RestClient.builder().baseUrl("http://ai")
            .messageConverters { it.add(0, JacksonJsonHttpMessageConverter(mapper)) }
        val server = MockRestServiceServer.bindTo(builder).build()
        return server to HttpDialogueInterpreter(builder.build(), mapper)
    }

    val tripId = UUID.fromString("00000000-0000-0000-0000-000000000001")
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
    )

    "되묻기 응답을 도메인으로 옮기고 맥락은 그대로 돌려받는다" {
        val (server, adapter) = server()
        server.expect(requestTo("http://ai/ai/v1/dialogue/interpret")).andExpect(method(HttpMethod.POST))
            .andExpect(jsonPath("$.utterance").value("거리 얼마나 돼?"))
            .andExpect(jsonPath("$.dialogue_context.turn_index").value(4))
            .andExpect(jsonPath("$.context.surface").value("ITINERARY"))
            .andExpect(jsonPath("$.context.itinerary.days[0].slots[0].slot_key").value("2026-11-02#p1"))
            .andExpect(jsonPath("$.request_meta.deadline_ms").value(5000))
            .andRespond(
                withSuccess(
                    """
                    {"outcome":"ARGUMENT_CLARIFY",
                     "frames":[{"intent":"GET_DISTANCE","arguments":{},"missing":["destination"],"confidence":0.95,"match_route":"CONFIDENT"}],
                     "clarify":{"frame_index":0,"argument":"destination","question":"어디까지의 거리를 알려 드릴까요?",
                                "options":["카페 모카","","${"가".repeat(31)}","해운대","광안리","자갈치","송정"]},
                     "dialogue_context":{"pending":{"intent":"GET_DISTANCE","arguments":{},"asked":"destination","confidence":0.95},"turn_index":4,"clarify_count":1},
                     "llm_calls":0}
                    """.trimIndent(),
                    MediaType.APPLICATION_JSON,
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
            server.expect(requestTo("http://ai/ai/v1/dialogue/interpret")).andRespond(withSuccess(body, MediaType.APPLICATION_JSON))
            shouldThrow<DialogueInterpretFailed> { adapter.interpret(request) }
        }
    }

    // ── 상대 계약 파일과 이름 대조 (AiBoundaryOpenApiTest 와 같은 방식) ──

    val schemas: JsonNode = mapper.readTree(aiContractFile())["components"]["schemas"]

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
        )
        checks.forEach { (node, schema) ->
            (keys(node) - props(schema)).shouldBeEmpty()       // 상대가 모르는 키(extra=forbid → 422)
            (required(schema) - keys(node)).shouldBeEmpty()    // 상대가 요구하는데 안 싣는 키
        }
    }

    "응답 와이어 이름이 상대 계약과 같다" {
        val wireResponse = setOf("outcome", "frames", "clarify", "dialogue_context", "llm_calls")
        props("DialogueInterpretResponse") shouldBe wireResponse
        props("DialogueFrameSchema") shouldBe setOf("intent", "arguments", "missing", "confidence", "match_route")
        props("DialogueClarifySchema") shouldBe setOf("frame_index", "argument", "question", "options")
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
