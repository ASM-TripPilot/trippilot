package com.trippilot.assistant.adapter.out.interpret

import com.trippilot.assistant.application.AssistantProperties
import com.trippilot.assistant.domain.Clarify
import com.trippilot.assistant.domain.ContextSnapshot
import com.trippilot.assistant.domain.DialogueInterpretFailed
import com.trippilot.assistant.domain.DialogueInterpretPort
import com.trippilot.assistant.domain.Intent
import com.trippilot.assistant.domain.IntentFrame
import com.trippilot.assistant.domain.InterpretOutcome
import com.trippilot.assistant.domain.InterpretRequest
import com.trippilot.assistant.domain.Interpretation
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Configuration
import org.springframework.http.MediaType
import org.springframework.http.client.SimpleClientHttpRequestFactory
import org.springframework.http.converter.json.JacksonJsonHttpMessageConverter
import org.springframework.web.client.RestClient
import tools.jackson.databind.JsonNode
import tools.jackson.databind.PropertyNamingStrategies
import tools.jackson.databind.json.JsonMapper
import tools.jackson.module.kotlin.KotlinModule
import java.time.Duration
import java.time.Instant
import java.time.LocalDate
import java.time.LocalTime
import java.util.UUID

/**
 * 해석 경계 실 어댑터 — 상대의 `POST /ai/v1/dialogue/interpret`(U8 FD §3, TRIP-1410).
 *
 * **이 경계의 실패는 일정 폴백 신호가 아니다**(BR-U8-45 · REL-U8-05) — `HttpScheduleAgentAdapter` 의 "4xx = 최소
 * 일정 폴백" 습관을 옮기지 않는다. 오류·시간초과·계약 위반은 전부 [DialogueInterpretFailed] 하나로 올리고,
 * 턴은 폴백 메시지 한 건으로 끝난다(`AssistantTurnService`).
 *
 * `dialogue_context` 는 상대 소유 직렬형이라 **읽지 않고 그대로 싣고 그대로 받는다**(INV-U8-07) — 문자열 ↔ JSON 노드
 * 변환만 한다.
 */
class HttpDialogueInterpreter(private val client: RestClient, private val mapper: JsonMapper) : DialogueInterpretPort {

    override fun interpret(request: InterpretRequest): Interpretation {
        val body = runCatching {
            client.post().uri(PATH)
                .contentType(MediaType.APPLICATION_JSON)
                .body(request.toWire(mapper))
                .retrieve()
                .body(WireResponse::class.java)
        }.getOrElse { e -> throw DialogueInterpretFailed("해석 경계 호출 실패: ${e.javaClass.simpleName}", e) }
            ?: throw DialogueInterpretFailed("해석 경계가 빈 응답을 돌려줬다")
        return body.toDomain(mapper)
    }

    companion object {
        const val PATH = "/ai/v1/dialogue/interpret"

        /** 되묻기 문안·보기의 길이 상한 — 받은 그대로 화면에 싣기 전에 여기서 건다(U8-INTERPRET-HTTP). */
        internal const val MAX_QUESTION_CHARS = 80
        internal const val MAX_OPTIONS = 4
        internal const val MAX_OPTION_CHARS = 30

        /** 경계 전용 매퍼 — snake_case + Kotlin. 앱 기본 매퍼와 무관하게 만든다(공개 API 영향 없음). */
        fun boundaryMapper(): JsonMapper = JsonMapper.builder()
            .addModule(KotlinModule.Builder().build())
            .propertyNamingStrategy(PropertyNamingStrategies.SNAKE_CASE)
            .build()
    }
}

// ── 와이어 (snake_case 매퍼가 이름을 바꾼다) ────────────────────────────────

internal data class WireMeta(val requestId: String, val requestedAt: Instant, val deadlineMs: Long)

internal data class WireSlot(val slotKey: String, val name: String?, val startAt: LocalTime, val category: String?)

internal data class WireDay(val date: LocalDate, val slots: List<WireSlot>)

internal data class WireItinerary(val status: String, val days: List<WireDay>)

internal data class WireTrip(val tripId: UUID, val regions: List<String>, val startDate: LocalDate, val endDate: LocalDate, val phase: String)

internal data class WireContext(val surface: String, val trip: WireTrip?, val baseStays: List<String>, val itinerary: WireItinerary?)

internal data class WireRequest(
    val requestMeta: WireMeta,
    val utterance: String,
    val dialogueContext: JsonNode?,
    val context: WireContext,
)

internal data class WireFrame(
    val intent: String,
    val arguments: Map<String, String> = emptyMap(),
    val missing: List<String> = emptyList(),
    val confidence: Double = 0.0,
    val matchRoute: String? = null,
)

internal data class WireClarify(val frameIndex: Int = 0, val argument: String, val question: String, val options: List<String>? = null)

internal data class WireResponse(
    val outcome: String,
    val frames: List<WireFrame> = emptyList(),
    val clarify: WireClarify? = null,
    val dialogueContext: JsonNode? = null,
    val llmCalls: Int? = null,
)

internal fun InterpretRequest.toWire(mapper: JsonMapper) = WireRequest(
    requestMeta = WireMeta(UUID.randomUUID().toString(), requestedAt, deadlineMs),
    utterance = utterance,
    // 첫 턴의 "{}" 도 그대로 객체로 싣는다 — 상대가 빈 상태로 읽는다.
    dialogueContext = runCatching { mapper.readTree(dialogueContext) }.getOrNull()?.takeIf { it.isObject },
    context = context.toWire(),
)

internal fun ContextSnapshot.toWire() = WireContext(
    surface = surface.name,
    trip = trip?.let { WireTrip(it.tripId, it.regions, it.startDate, it.endDate, it.phase) },
    baseStays = baseStays,
    itinerary = itinerary?.let { it ->
        WireItinerary(it.status, it.days.map { d -> WireDay(d.date, d.slots.map { s -> WireSlot(s.slotKey, s.name, s.startAt, s.category) }) })
    },
)

internal fun WireResponse.toDomain(mapper: JsonMapper): Interpretation {
    val outcome = runCatching { InterpretOutcome.valueOf(outcome) }
        .getOrElse { throw DialogueInterpretFailed("모르는 outcome: $outcome") }
    val frames = frames.map { f ->
        // 표 밖 의도는 만들 수 없다(PBT-U8-9) — 지어낸 라벨로 처리기를 부르지 않는다.
        val intent = runCatching { Intent.valueOf(f.intent) }.getOrElse { throw DialogueInterpretFailed("모르는 의도: ${f.intent}") }
        IntentFrame(intent, f.arguments, f.matchRoute)
    }
    val clarify = clarify?.let { c ->
        if (c.question.isBlank() || c.question.length > HttpDialogueInterpreter.MAX_QUESTION_CHARS) {
            throw DialogueInterpretFailed("되묻기 문안이 비었거나 길다(${c.question.length}자)")
        }
        val options = c.options.orEmpty().filter { it.isNotBlank() && it.length <= HttpDialogueInterpreter.MAX_OPTION_CHARS }
            .take(HttpDialogueInterpreter.MAX_OPTIONS)
        Clarify(c.argument, c.question, options)
    }
    val context = dialogueContext?.takeIf { it.isObject } ?: throw DialogueInterpretFailed("dialogue_context 가 없다")
    return Interpretation(
        outcome = outcome,
        frames = frames,
        clarify = clarify,
        dialogueContext = mapper.writeValueAsString(context),
        // 빠지면 상한이 0으로 센다(COST-U8-02) — 계약 위반으로 본다.
        llmCalls = llmCalls ?: throw DialogueInterpretFailed("llm_calls 가 없다"),
    )
}

/**
 * http 모드에서만 서는 설정. 일정 경계(`ScheduleAgentConfiguration`)와 같은 격리 원칙 — 공유 빌더·컨버터 빈을 쓰지 않는다.
 * 읽기 상한 = 해석 단계 상한 + 왕복 여유(PERF-U8-02) — 턴 예산을 넘겨 기다리지 않는다.
 */
@Configuration
@ConditionalOnProperty(name = ["trippilot.assistant.interpret.mode"], havingValue = "http")
class HttpDialogueInterpreterConfiguration {
    @Bean
    fun httpDialogueInterpreter(properties: AssistantProperties): DialogueInterpretPort {
        val mapper = HttpDialogueInterpreter.boundaryMapper()
        val interpret = properties.interpret
        val client = RestClient.builder()
            .baseUrl(interpret.baseUrl)
            .requestFactory(
                SimpleClientHttpRequestFactory().apply {
                    setConnectTimeout(Duration.ofMillis(interpret.connectTimeoutMs))
                    setReadTimeout(Duration.ofMillis(properties.interpretStageMaxMs + properties.readMarginMs))
                },
            )
            .messageConverters { it.add(0, JacksonJsonHttpMessageConverter(mapper)) }
            .let { b -> if (interpret.serviceToken.isBlank()) b else b.defaultHeader(SERVICE_TOKEN_HEADER, interpret.serviceToken) }
            .build()
        return HttpDialogueInterpreter(client, mapper)
    }

    private companion object {
        /** 일정 경계와 같은 문자열이지만 묶지 않는다 — 상대가 받는 계약이라 검증자가 다르다(ScheduleAgentConfiguration 주석). */
        const val SERVICE_TOKEN_HEADER = "X-Service-Token"
    }
}
