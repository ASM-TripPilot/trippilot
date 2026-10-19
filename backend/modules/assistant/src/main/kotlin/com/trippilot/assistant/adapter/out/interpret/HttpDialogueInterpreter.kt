package com.trippilot.assistant.adapter.out.interpret

import com.trippilot.assistant.application.AssistantProperties
import com.trippilot.assistant.application.AssistantTemplates
import com.trippilot.assistant.domain.AnswerKind
import com.trippilot.assistant.domain.Clarify
import com.trippilot.assistant.domain.ContextSnapshot
import com.trippilot.assistant.domain.DialogueInterpretFailed
import com.trippilot.assistant.domain.DialogueInterpretPort
import com.trippilot.assistant.domain.DialogueMemoryPort
import com.trippilot.assistant.domain.Intent
import com.trippilot.assistant.domain.IntentFrame
import com.trippilot.assistant.domain.InterpretOutcome
import com.trippilot.assistant.domain.InterpretRequest
import com.trippilot.assistant.domain.Interpretation
import com.trippilot.assistant.domain.InterpretedAnswer
import com.trippilot.assistant.domain.InterpretedQuickReply
import com.trippilot.assistant.domain.MemoryItem
import com.trippilot.assistant.domain.NextAction
import com.trippilot.assistant.domain.QuickReplyAction
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
 * 해석 경계 실 어댑터 — 상대의 `POST /ai/v1/dialogue/interpret`(U8 FD §3, TRIP-1410 · assistant-orchestrator 1단계).
 *
 * **이 경계의 실패는 일정 폴백 신호가 아니다**(BR-U8-45 · REL-U8-05) — `HttpScheduleAgentAdapter` 의 "4xx = 최소
 * 일정 폴백" 습관을 옮기지 않는다. 오류·시간초과·계약 위반은 전부 [DialogueInterpretFailed] 하나로 올리고,
 * 턴은 폴백 메시지 한 건으로 끝난다(`AssistantTurnService`).
 *
 * `dialogue_context` 는 상대 소유 직렬형이라 **읽지 않고 그대로 싣고 그대로 받는다**(INV-U8-07) — 문자열 ↔ JSON 노드
 * 변환만 한다.
 *
 * 상대가 답까지 완성한 `ANSWER` 는 **다시 검증한다**(BLM §10 — 상대 게이트가 1차, 여기가 2차): 문장 길이는 DB CHECK 와 같은
 * 값에서 끊고, 앱이 모르는 다음 행동은 "내가 할 수 있는 것 보기"로 바꾸고(앱 규칙과 같게), 어휘 밖 빠른 답은 버린다.
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
        const val MEMORY_PATH = "/ai/v1/dialogue/memory"

        /** 이 모듈이 부르는 상대 경로 전부 — 계약 파일에 실재해야 한다(`HttpScheduleAgentAdapter.CALLED_PATHS` 선례, 게이트는 `HttpDialogueInterpreterTest`). */
        val DIALOGUE_PATHS = listOf(PATH, MEMORY_PATH)

        /** 되묻기 문안·보기의 길이 상한 — 받은 그대로 화면에 싣기 전에 여기서 건다(U8-INTERPRET-HTTP). */
        internal const val MAX_QUESTION_CHARS = 80
        internal const val MAX_OPTIONS = 4
        internal const val MAX_OPTION_CHARS = 30

        /** 답 문장 상한 — `assistant_message.text` 의 DB CHECK(≤2000) 와 같은 값. 넘으면 자르지 않고 계약 위반으로 본다(상대 상한은 600). */
        internal const val MAX_ANSWER_CHARS = 2000

        /**
         * 상대 `timeout_backstop` = deadline_ms + 5s (리마인드·회고 경계와 같은 값). 읽기 상한은 해석 단계 상한에 이 여유를 더한 값이다 —
         * 종전 `readMarginMs`(1s) 파생식은 상대가 마감을 넘겨 정리하는 응답을 우리가 먼저 끊었다(PERF-U8-01 개정).
         * 요청마다 싣는 `deadline_ms` 는 늘 `interpretStageMaxMs` 이하이므로 read ≥ deadline + 5s 가 구조적으로 성립한다.
         */
        const val AI_BACKSTOP_MARGIN_MS = 5_000L

        /** 경계 전용 매퍼 — snake_case + Kotlin. 앱 기본 매퍼와 무관하게 만든다(공개 API 영향 없음). */
        fun boundaryMapper(): JsonMapper = JsonMapper.builder()
            .addModule(KotlinModule.Builder().build())
            .propertyNamingStrategy(PropertyNamingStrategies.SNAKE_CASE)
            .build()
    }
}

/**
 * 상대 세션 메모리 경계 — `DELETE|GET /ai/v1/dialogue/memory`(DE §3.3). 해석기와 **같은** 클라이언트·매퍼를 쓴다(같은 서비스다).
 * 실패는 그대로 올린다 — 접을지 재시도할지는 호출측이 정한다([DialogueMemoryPort]). 쿼리 값(계정 식별자)은 로그에 싣지 않는다.
 */
class HttpDialogueMemoryClient(private val client: RestClient) : DialogueMemoryPort {
    override fun deleteBySession(sessionId: UUID): Int = delete("session_id", sessionId.toString())
    override fun deleteByTrip(tripId: UUID): Int = delete("trip_id", tripId.toString())
    override fun deleteByAccount(accountRef: String): Int = delete("account_ref", accountRef)

    private fun delete(key: String, value: String): Int =
        client.delete().uri { it.path(HttpDialogueInterpreter.MEMORY_PATH).queryParam(key, value).build() }
            .retrieve().body(WireMemoryDeleted::class.java)?.deleted
            ?: throw IllegalStateException("메모리 파기 응답이 비었다")

    override fun export(accountRef: String): List<MemoryItem> =
        client.get().uri { it.path(HttpDialogueInterpreter.MEMORY_PATH).queryParam("account_ref", accountRef).build() }
            .retrieve().body(WireMemoryExport::class.java)?.memories.orEmpty()
            .map { MemoryItem(it.sessionId, it.tripId, it.summary, it.updatedAt) }
}

/** `http` 가 아닌 모드의 메모리 경계 — 상대 메모리가 생기지 않으니 지울 것도 낼 것도 없다. */
object NoopDialogueMemory : DialogueMemoryPort {
    override fun deleteBySession(sessionId: UUID) = 0
    override fun deleteByTrip(tripId: UUID) = 0
    override fun deleteByAccount(accountRef: String) = 0
    override fun export(accountRef: String): List<MemoryItem> = emptyList()
}

// ── 와이어 (snake_case 매퍼가 이름을 바꾼다) ────────────────────────────────

internal data class WireMeta(val requestId: String, val requestedAt: Instant, val deadlineMs: Long)

internal data class WireSlot(val slotKey: String, val name: String?, val startAt: LocalTime, val category: String?)

internal data class WireDay(val date: LocalDate, val slots: List<WireSlot>)

internal data class WireItinerary(val status: String, val days: List<WireDay>)

internal data class WireTrip(val tripId: UUID, val regions: List<String>, val startDate: LocalDate, val endDate: LocalDate, val phase: String)

internal data class WireContext(val surface: String, val trip: WireTrip?, val baseStays: List<String>, val itinerary: WireItinerary?)

internal data class WireTurn(val role: String, val text: String)

internal data class WireRequest(
    val requestMeta: WireMeta,
    val utterance: String,
    val dialogueContext: JsonNode?,
    val context: WireContext,
    val sessionId: String,
    val accountRef: String,
    val recentTurns: List<WireTurn>,
)

internal data class WireFrame(
    val intent: String,
    val arguments: Map<String, String> = emptyMap(),
    val missing: List<String> = emptyList(),
    val confidence: Double = 0.0,
    val matchRoute: String? = null,
)

internal data class WireClarify(val frameIndex: Int = 0, val argument: String, val question: String, val options: List<String>? = null)

internal data class WireNextAction(val type: String, val label: String, val params: Map<String, String> = emptyMap())

internal data class WireQuickReply(val label: String, val action: String, val params: Map<String, String> = emptyMap())

internal data class WireAnswer(
    val kind: String,
    val text: String,
    val payload: Map<String, Any?>? = null,
    val nextActions: List<WireNextAction> = emptyList(),
    val quickReplies: List<WireQuickReply>? = null,
    val footnote: String? = null,
)

internal data class WireResponse(
    val outcome: String,
    val frames: List<WireFrame> = emptyList(),
    val clarify: WireClarify? = null,
    val dialogueContext: JsonNode? = null,
    val llmCalls: Int? = null,
    val answer: WireAnswer? = null,
)

internal data class WireMemoryDeleted(val deleted: Int)

internal data class WireMemoryItem(
    val sessionId: String,
    val tripId: String? = null,
    val summary: List<String> = emptyList(),
    val summarizedTurnIndex: Int = 0,
    val updatedAt: Instant,
    val expiresAt: Instant,
)

internal data class WireMemoryExport(val memories: List<WireMemoryItem> = emptyList())

internal fun InterpretRequest.toWire(mapper: JsonMapper) = WireRequest(
    // 상대가 이 값을 trace_id 로 로그에 남긴다 — 호출자가 만든 번호를 그대로 싣는다(같은 값이 그 턴의 도우미 행에 적힌다)
    requestMeta = WireMeta(traceId, requestedAt, deadlineMs),
    utterance = utterance,
    // 첫 턴의 "{}" 도 그대로 객체로 싣는다 — 상대가 빈 상태로 읽는다.
    dialogueContext = runCatching { mapper.readTree(dialogueContext) }.getOrNull()?.takeIf { it.isObject },
    context = context.toWire(),
    sessionId = sessionId.toString(),
    accountRef = accountRef,
    recentTurns = recentTurns.map { WireTurn(it.role.name, it.text) },
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
    // ANSWER 인데 답이 없으면 지어낼 것이 없다 — 계약 위반으로 본다(턴은 폴백 메시지 한 건, BR-U8-40).
    val answer = if (outcome == InterpretOutcome.ANSWER) (answer ?: throw DialogueInterpretFailed("ANSWER 인데 answer 가 없다")).toDomain() else null
    return Interpretation(
        outcome = outcome,
        frames = frames,
        clarify = clarify,
        dialogueContext = mapper.writeValueAsString(context),
        // 빠지면 상한이 0으로 센다(COST-U8-02) — 계약 위반으로 본다.
        llmCalls = llmCalls ?: throw DialogueInterpretFailed("llm_calls 가 없다"),
        answer = answer,
    )
}

/** 상대 문장·카드의 2차 검증(BLM §10). 자르거나 고쳐 내지 않는다 — 어긋나면 계약 위반, 모르는 행동만 아는 것으로 바꾼다. */
internal fun WireAnswer.toDomain(): InterpretedAnswer {
    val kind = runCatching { AnswerKind.valueOf(kind) }.getOrElse { throw DialogueInterpretFailed("모르는 answer.kind: $kind") }
    if (text.isBlank() || text.length > HttpDialogueInterpreter.MAX_ANSWER_CHARS) throw DialogueInterpretFailed("answer.text 가 비었거나 길다(${text.length}자)")
    if (nextActions.isEmpty()) throw DialogueInterpretFailed("answer.next_actions 가 비었다") // 막다른 답은 저장도 거부한다(INV-U8-03)
    return InterpretedAnswer(
        kind = kind,
        text = text,
        payload = payload,
        // 앱이 모르는 행동은 그리지 못한다 — 막다른 버튼 대신 "내가 할 수 있는 것 보기"(앱의 모르는 값 처리와 같게). 겹치면 하나만.
        nextActions = nextActions.map { a -> if (a.type in NextAction.TYPES) NextAction(a.type, a.label, a.params) else AssistantTemplates.CAPABILITIES_ACTION }.distinct(),
        // 어휘 밖 action 은 서버가 발급할 수 없다 — 버린다. null(시작 칩)과 빈 목록은 그대로 둔다.
        quickReplies = quickReplies?.mapNotNull { q ->
            runCatching { QuickReplyAction.valueOf(q.action) }.getOrNull()?.let { InterpretedQuickReply(q.label, it, q.params) }
        },
        footnote = footnote,
    )
}

/**
 * 해석·메모리 경계의 배선. 일정 경계(`ScheduleAgentConfiguration`)와 같은 격리 원칙 — 공유 빌더·컨버터 빈을 쓰지 않는다.
 * 해석기는 `http` 모드에서만 서고, 메모리 경계는 **늘 선다** — `http` 면 실 클라이언트, 아니면 no-op(지울 상대 메모리가 없다).
 * 두 실 클라이언트는 한 `RestClient` 를 나눠 쓴다(같은 서비스·같은 자격·같은 상한).
 */
@Configuration
class HttpDialogueInterpreterConfiguration {
    private val mapper = HttpDialogueInterpreter.boundaryMapper()
    private var shared: RestClient? = null

    @Bean
    @ConditionalOnProperty(name = ["trippilot.assistant.interpret.mode"], havingValue = "http")
    fun httpDialogueInterpreter(properties: AssistantProperties): DialogueInterpretPort = HttpDialogueInterpreter(client(properties), mapper)

    @Bean
    fun dialogueMemory(properties: AssistantProperties): DialogueMemoryPort =
        // 해석 모드와 묶지 않는다 — 시크릿을 off 로 돌린 동안에도 이력·여행·계정 파기는 상대 DB 에 닿아야 한다(2026-10-18 리뷰:
        // off 이면 계정 삭제가 0 을 돌려받고 아웃박스가 완료 처리돼 즉시 파기가 조용히 빠졌다). 상대가 없는 대역 모드만 no-op.
        if (properties.interpret.mode == "fake") NoopDialogueMemory else HttpDialogueMemoryClient(client(properties))

    @Synchronized
    private fun client(properties: AssistantProperties): RestClient = shared ?: build(properties).also { shared = it }

    /** 읽기 상한 = 해석 단계 상한 + 상대 백스톱 여유(PERF-U8-01) — 턴 예산을 넘겨 기다리지 않되 상대가 정리하는 응답은 끊지 않는다. */
    private fun build(properties: AssistantProperties): RestClient {
        val interpret = properties.interpret
        return RestClient.builder()
            .baseUrl(interpret.baseUrl)
            .requestFactory(
                SimpleClientHttpRequestFactory().apply {
                    setConnectTimeout(Duration.ofMillis(interpret.connectTimeoutMs))
                    setReadTimeout(Duration.ofMillis(properties.interpretStageMaxMs + HttpDialogueInterpreter.AI_BACKSTOP_MARGIN_MS))
                },
            )
            .messageConverters { it.add(0, JacksonJsonHttpMessageConverter(mapper)) }
            .let { b -> if (interpret.serviceToken.isBlank()) b else b.defaultHeader(SERVICE_TOKEN_HEADER, interpret.serviceToken) }
            .build()
    }

    private companion object {
        /** 일정 경계와 같은 문자열이지만 묶지 않는다 — 상대가 받는 계약이라 검증자가 다르다(ScheduleAgentConfiguration 주석). */
        const val SERVICE_TOKEN_HEADER = "X-Service-Token"
    }
}
