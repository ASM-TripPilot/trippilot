package com.trippilot.assistant.domain

import java.time.Instant
import java.time.LocalDate
import java.time.LocalTime
import java.util.UUID

/** 도우미를 연 화면(BR-U8-02) — 앱이 보내는 문맥은 이 값과 `tripId` 뿐이다. */
enum class AssistantSurface { HOME, STAY_SEARCH, ITINERARY, LIVE, STAY_DETAIL }

/**
 * 해석된 의도(closed-set, PBT-U8-9). 상대(ai) 라우터의 어휘 13종 + 범위 밖 —
 * 표 밖 값은 만들 수 없다(역직렬화가 거부한다). 의도마다 처리기는 정확히 하나다.
 */
enum class Intent {
    EDIT_SCHEDULE, SUGGEST_ALTERNATIVE, REPLAN, REGENERATE, GENERATE_SCHEDULE,
    SHOW_SCHEDULE, GET_NEXT_SLOT, GET_DISTANCE, GET_POI_INFO, GET_WEATHER,
    GENERATE_REFLECTION, TRIP_SUMMARY, STYLE_ANALYSIS,
    OUT_OF_SCOPE,
}

enum class InterpretOutcome { FRAME, ARGUMENT_CLARIFY, OUT_OF_SCOPE }

/** 의도 하나와 그 인자. [arguments] 의 값은 요청이지 확정값이 아니다 — 시각이 담겨도 화면에 그대로 내지 않는다(BR-DLG-05). */
data class IntentFrame(val intent: Intent, val arguments: Map<String, String>, val matchRoute: String?)

/** 인자 되묻기 — 문안은 상대가 인자 이름으로 고른 고정 문장이다(BR-U8-11). */
data class Clarify(val argument: String, val question: String, val options: List<String>)

/**
 * 해석 결과(FD §3.2).
 *
 * @property dialogueContext 상대 `DialogueContext` 직렬형 **그대로**. 백엔드는 읽지도 고치지도 않고 저장·반송한다(INV-U8-07).
 * @property llmCalls 이 해석이 쓴 LLM 호출 수 — 사용량 상한의 원천이다. 빠지면 상한이 0으로 센다(COST-U8-02).
 */
data class Interpretation(
    val outcome: InterpretOutcome,
    val frames: List<IntentFrame>,
    val clarify: Clarify?,
    val dialogueContext: String,
    val llmCalls: Int,
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
) {
    /** @property phase `PLANNING`|`IN_TRIP`|`ENDED` */
    data class TripBlock(val tripId: UUID, val regions: List<String>, val startDate: LocalDate, val endDate: LocalDate, val phase: String)

    data class ItineraryBlock(val status: String, val days: List<DayBlock>)

    data class DayBlock(val date: LocalDate, val slots: List<SlotBlock>)

    /** [startAt] 은 저장된(검증된) 계획 시각이다. 소요시간은 없다(INV-3). */
    data class SlotBlock(val slotKey: String, val name: String?, val startAt: LocalTime, val category: String?)
}

data class InterpretRequest(
    val utterance: String,
    val surface: AssistantSurface,
    /** 서버가 권한을 확인해 직접 읽은 것만 — 앱이 보낸 일정 내용은 여기 오지 않는다(BR-U8-02). */
    val context: ContextSnapshot,
    /** 저장돼 있던 직렬형 — `turn_index` 는 호출측이 이미 올렸다. */
    val dialogueContext: String,
    val requestedAt: Instant,
    val deadlineMs: Long,
)

/**
 * 발화 해석 경계(FD §3) — 상대의 `POST /ai/v1/dialogue/interpret`. 지금 구현은 대역뿐이다(상대 미구현, G-U8-4).
 *
 * 실패는 [DialogueInterpretFailed] 로 올린다. **이 경계의 실패는 일정 폴백 신호가 아니다**(BR-U8-45) —
 * 그 턴이 폴백 메시지 한 건으로 끝날 뿐이다.
 */
interface DialogueInterpretPort {
    fun interpret(request: InterpretRequest): Interpretation
}

class DialogueInterpretFailed(message: String, cause: Throwable? = null) : RuntimeException(message, cause)
