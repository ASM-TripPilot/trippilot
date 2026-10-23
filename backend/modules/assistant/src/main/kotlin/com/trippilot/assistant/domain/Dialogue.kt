package com.trippilot.assistant.domain

import java.time.Instant
import java.time.LocalDate
import java.time.LocalTime
import java.util.UUID

/** 도우미를 연 화면(BR-U8-02) — 앱이 보내는 문맥은 이 값과 `tripId` 뿐이다. */
enum class AssistantSurface { HOME, STAY_SEARCH, ITINERARY, LIVE, STAY_DETAIL }

/**
 * 해석된 의도(closed-set, PBT-U8-9). 상대(ai) 라우터의 어휘 13종 + 장소 탐색·추천(도우미 직접 분류 전용, 2026-10-19·10-20) + 범위 밖 —
 * 표 밖 값은 만들 수 없다(역직렬화가 거부한다). 의도마다 처리기는 정확히 하나다.
 */
enum class Intent {
    EDIT_SCHEDULE, SUGGEST_ALTERNATIVE, REPLAN, REGENERATE, GENERATE_SCHEDULE,
    SHOW_SCHEDULE, GET_NEXT_SLOT, GET_DISTANCE, GET_POI_INFO, GET_WEATHER,
    GENERATE_REFLECTION, TRIP_SUMMARY, STYLE_ANALYSIS,
    EXPLORE_PLACES, RECOMMEND_PLACES, RECOMMEND_REGION,
    OUT_OF_SCOPE,
}

/** `ANSWER` 는 상대 오케스트레이터가 답까지 완성한 턴이다(assistant-orchestrator FD DE §3.2) — [Interpretation.answer] 가 함께 온다. */
enum class InterpretOutcome { FRAME, ARGUMENT_CLARIFY, OUT_OF_SCOPE, ANSWER }

/** 의도 하나와 그 인자. [arguments] 의 값은 요청이지 확정값이 아니다 — 시각이 담겨도 화면에 그대로 내지 않는다(BR-DLG-05). */
data class IntentFrame(val intent: Intent, val arguments: Map<String, String>, val matchRoute: String?)

/** 인자 되묻기 — 문안은 상대가 인자 이름으로 고른 고정 문장이다(BR-U8-11). */
data class Clarify(val argument: String, val question: String, val options: List<String>)

/** 상대가 낼 수 있는 카드 종류(1단계, DE §2.3). 2단계의 `PROPOSAL` 은 아직 없다 — 표 밖 값은 계약 위반이다. */
enum class AnswerKind { TEXT, INFO, CANDIDATES }

/** 상대가 제안한 빠른 답 — **id 가 없다.** 서버가 발급해야(`qr-ai-{8자}-{i}`) 다음 턴에 받아진다(앱은 발급분만 보낸다). */
data class InterpretedQuickReply(val label: String, val action: QuickReplyAction, val params: Map<String, String>)

/**
 * 상대가 완성한 답(DE §3.2). [text] 는 상대 출구 게이트를 지난 LLM 문장(또는 상대 템플릿)이고 kind·payload·nextActions·quickReplies 는
 * 상대 핸들러의 결정론 산출이다 — 그래도 백엔드가 **다시 검증한다**(BLM §10): 길이·행동 집합은 어댑터가, 후보 실존·슬롯 실재는 턴 서비스가.
 * 소요시간 칸은 없다(INV-3).
 */
data class InterpretedAnswer(
    val kind: AnswerKind,
    val text: String,
    /** INFO: `{infoKind, title, rows[{label, value}]}` · CANDIDATES: `{candidates[{poiId, name, distanceRange?, reason}]}` · TEXT: null. 저장된 그대로 앱에 간다. */
    val payload: Map<String, Any?>?,
    val nextActions: List<NextAction>,
    /** null 과 빈 목록은 뜻이 다르다 — null 은 "정하지 않았다"(앱이 시작 빠른 답을 보인다). */
    val quickReplies: List<InterpretedQuickReply>?,
    val footnote: String?,
)

/**
 * 해석 결과(FD §3.2).
 *
 * @property dialogueContext 상대 `DialogueContext` 직렬형 **그대로**. 백엔드는 읽지도 고치지도 않고 저장·반송한다(INV-U8-07).
 * @property llmCalls 이 해석이 쓴 LLM 호출 수 — 사용량 상한의 원천이다. 빠지면 상한이 0으로 센다(COST-U8-02).
 * @property answer [outcome] 이 `ANSWER` 일 때의 답. 그 밖에는 null.
 */
data class Interpretation(
    val outcome: InterpretOutcome,
    val frames: List<IntentFrame>,
    val clarify: Clarify?,
    val dialogueContext: String,
    val llmCalls: Int,
    val answer: InterpretedAnswer? = null,
)

/**
 * 해석에 보내는 컨텍스트(FD §5) — **이 타입에 있는 칸이 보내는 것의 전부다**(화이트리스트, BR-U8-22).
 * 가격·제휴 정보·리비전·후보 풀·점수·취향·위치는 칸이 없다. "보여 주지 마"를 프롬프트에 부탁하지 않고,
 * 실을 자리를 두지 않는다(PRD 02-6).
 */
data class ContextSnapshot(
    val surface: AssistantSurface,
    val trip: TripBlock?,
    /** 기준 숙소 이름. 지금은 첫 숙박일의 것 하나만 실린다(칩이 말하는 그 숙소). */
    val baseStays: List<String>,
    val itinerary: ItineraryBlock?,
    /** 계정 취향 — 지역 추천(RECOMMEND_REGION) 재료. 고른 축이 하나도 없으면 null. 상대가 쓰는 두 축(styles·activities)만 싣는다(SEC-U8-08). */
    val tastes: Tastes? = null,
) {
    data class Tastes(val styles: List<String>, val activities: List<String>)

    /** @property phase `PLANNING`|`IN_TRIP`|`ENDED` */
    data class TripBlock(val tripId: UUID, val regions: List<String>, val startDate: LocalDate, val endDate: LocalDate, val phase: String)

    data class ItineraryBlock(val status: String, val days: List<DayBlock>)

    data class DayBlock(val date: LocalDate, val slots: List<SlotBlock>)

    /** [startAt] 은 저장된(검증된) 계획 시각이다. 소요시간은 없다(INV-3). */
    data class SlotBlock(val slotKey: String, val name: String?, val startAt: LocalTime, val category: String?)
}

/** 단기 기억 한 줄(BR-AO-11) — 원문이 있는 저장 메시지만, 300자까지. 상대는 저장하지 않는다. */
data class RecentTurn(val role: MessageRole, val text: String)

data class InterpretRequest(
    val utterance: String,
    val surface: AssistantSurface,
    /** 서버가 권한을 확인해 직접 읽은 것만 — 앱이 보낸 일정 내용은 여기 오지 않는다(BR-U8-02). */
    val context: ContextSnapshot,
    /** 저장돼 있던 직렬형 — `turn_index` 는 호출측이 이미 올렸다. */
    val dialogueContext: String,
    val requestedAt: Instant,
    val deadlineMs: Long,
    /** 상대 세션 메모리의 키(DE §3.1). */
    val sessionId: UUID,
    /** 계정 식별자 — 상대 메모리의 묶음 키이자 파기·내보내기 키. **로그에 싣지 않는다**(SEC-U8-06). */
    val accountRef: String,
    /** 이번 발화 앞의 대화, 오래된 것부터 ≤20건(BR-U8-22 화이트리스트 확장). 이번 발화는 [utterance] 로 가므로 여기 없다. */
    val recentTurns: List<RecentTurn>,
    /**
     * 이 호출의 추적 번호 — 와이어 `request_meta.request_id` 로 가고, 상대가 같은 값을 `trace_id` 로 로그에 남긴다.
     * **호출자가 만든다** — 그래야 호출이 실패해도 그 턴의 도우미 행에 같은 값을 적을 수 있다(BR-U8-64).
     */
    val traceId: String,
)

/**
 * 발화 해석 경계(FD §3) — 상대의 `POST /ai/v1/dialogue/interpret`.
 *
 * 실패는 [DialogueInterpretFailed] 로 올린다. **이 경계의 실패는 일정 폴백 신호가 아니다**(BR-U8-45) —
 * 그 턴이 폴백 메시지 한 건으로 끝날 뿐이다.
 */
interface DialogueInterpretPort {
    fun interpret(request: InterpretRequest): Interpretation
}

class DialogueInterpretFailed(message: String, cause: Throwable? = null) : RuntimeException(message, cause)

/**
 * 상대 세션 메모리의 파기·내보내기(`/ai/v1/dialogue/memory`, DE §3.3·§4.1 · BR-AO-10). 백엔드 대화가 사라지는 길마다
 * 상대 요약도 같이 가야 한다 — 안 가면 "지웠는데 기억한다"가 상대 TTL(90일)만큼 남는다.
 *
 * 파기는 **멱등**이고 지울 것이 없으면 0 이다(오류 아님). 실패는 예외로 올린다(종류 불문) — 세 파기 경로(이력 지우기·여행 삭제·
 * 계정 삭제)가 모두 아웃박스 구독에서 불러 실패하면 릴레이가 재시도한다(미결 #13). 답하는 사이 지워진 대화의 재파기만 최선 노력이다.
 * `http` 모드가 아니면(fake·off) no-op 이다 — 상대 메모리가 생기지 않으니 지울 것도 없다.
 */
interface DialogueMemoryPort {
    fun deleteBySession(sessionId: UUID): Int
    fun deleteByTrip(tripId: UUID): Int
    fun deleteByAccount(accountRef: String): Int
    fun export(accountRef: String): List<MemoryItem>
}

/** 상대 요약 한 묶음 — 세션 하나의 줄들(≤20줄). 내보내기는 줄 단위로 푼다(DATA-U8-06). */
data class MemoryItem(val sessionId: String, val tripId: String?, val summary: List<String>, val updatedAt: Instant)
