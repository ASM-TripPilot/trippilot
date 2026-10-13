package com.trippilot.assistant.application

import com.trippilot.assistant.domain.MessageKind
import com.trippilot.assistant.domain.MessageRole
import com.trippilot.assistant.domain.NewMessage
import com.trippilot.assistant.domain.NextAction
import com.trippilot.assistant.domain.QuickReply
import com.trippilot.assistant.domain.QuickReplyAction

/**
 * 도우미가 화면에 내는 **모든 문장**(DEC-U8-6 · BR-U8-26). LLM 이 쓴 문장은 여기 없다 — 해석 결과는 의도와 인자일 뿐이고,
 * 말은 이 표에서 고른다. 그래서 지침 유출·주입 문장이 응답 문구로 새는 길이 구조적으로 없다(SEC-U8-03).
 *
 * 모든 응답은 다음 행동을 하나 이상 싣는다(BR-U8-06 · INV-U8-03) — 거절·폴백도 예외가 아니다.
 * **소요시간을 말하는 문장은 없다**(INV-3).
 */
object AssistantTemplates {
    val CAPABILITIES_ACTION = NextAction("SHOW_CAPABILITIES", "내가 할 수 있는 것 보기")
    private val RETRY = NextAction("RETRY_TURN", "다시 시도")

    /** 모든 폴백에 있다(BR-U8-41) — 핵심 흐름은 도우미 없이도 끝까지 간다. */
    private val CONTINUE = NextAction("CONTINUE_WITHOUT_ASSISTANT", "도우미 없이 계속")
    private val CREATE_TRIP = NextAction("CREATE_TRIP", "여행 만들기")
    private val STAY_SEARCH = NextAction("OPEN_STAY_SEARCH", "숙소 검색 열기")

    const val CAPABILITIES_LINE = "일정 검토, 다음 장소·날씨·거리 확인, 일정 변경 제안, 다시 짜기 안내를 도와드려요."

    private fun assistant(
        kind: MessageKind,
        text: String,
        nextActions: List<NextAction>,
        outcome: String,
        payload: Map<String, Any?>? = null,
        quickReplies: List<QuickReply>? = null,
    ) = NewMessage(
        role = MessageRole.ASSISTANT, kind = kind, text = text, payload = payload,
        nextActions = nextActions, quickReplies = quickReplies, outcome = outcome,
    )

    /** "내가 할 수 있는 것" — 예시 빠른 답을 다시 보인다. */
    fun capabilities(hasTrip: Boolean) = assistant(
        MessageKind.TEXT, "이런 걸 도와드릴 수 있어요. $CAPABILITIES_LINE",
        listOf(if (hasTrip) NextAction("OPEN_ITINERARY", "일정 보기") else CREATE_TRIP),
        outcome = "CAPABILITIES", quickReplies = StartQuickReplies.of(hasTrip),
    )

    /** 화면 넘기기(FD §4) — 오래 걸리거나 화면 상태가 필요한 일은 기존 화면으로 보낸다. 실행이 아니라 이동이다. */
    fun handoff(text: String, vararg actions: NextAction) =
        assistant(MessageKind.TEXT, text, actions.toList(), outcome = "FRAME")

    /** 여행이 없는데 일정·동선을 물었다(BR-U8-05). 막지 않고 길을 준다. */
    fun needTrip() = assistant(
        MessageKind.TEXT, "먼저 여행을 만들거나 숙소를 등록하면 일정을 함께 볼 수 있어요.",
        listOf(CREATE_TRIP, STAY_SEARCH), outcome = "FRAME",
    )

    /** 범위 밖(BR-U8-27·29). 숙소 화면에서 물었으면 숙소 검색을 가장 가까운 대안으로 준다. */
    fun outOfScope(nearStay: Boolean) = assistant(
        MessageKind.SCOPE, "그건 제가 도와드리기 어려워요.",
        listOfNotNull(STAY_SEARCH.takeIf { nearStay }, CAPABILITIES_ACTION),
        outcome = "OUT_OF_SCOPE", payload = mapOf("reason" to "도우미가 다루지 않는 요청이에요."),
    )

    /** 정책 위반 입력(BR-U8-23). 원문도 매칭된 말도 싣지 않는다 — 범주만. */
    fun refusal(category: String?) = assistant(
        MessageKind.REFUSAL, "이 요청은 도와드릴 수 없어요.",
        listOf(CAPABILITIES_ACTION), outcome = "REFUSAL",
        payload = mapOf("category" to (category ?: "POLICY"), "capabilities" to CAPABILITIES_LINE),
    )

    /** 거절이 이어지면 같은 말을 되풀이하지 않고 쓰는 법을 안내한다(BR-U8-25). */
    fun usageGuide(hasTrip: Boolean) = assistant(
        MessageKind.TEXT, "이렇게 물어보시면 도와드릴 수 있어요. $CAPABILITIES_LINE",
        listOf(CAPABILITIES_ACTION), outcome = "REFUSAL", quickReplies = StartQuickReplies.of(hasTrip),
    )

    /** 해석을 못 했다 — 상대 불통·시한·입력 검사 불가. 그 턴은 이 한 건으로 끝난다(BR-U8-40). */
    fun fallback(cause: FallbackCause) = assistant(
        MessageKind.FALLBACK, cause.text, listOf(RETRY, CONTINUE), outcome = "FALLBACK_${cause.name}",
        payload = mapOf("cause" to cause.name),
        quickReplies = listOf(QuickReply("qr-retry", "다시 시도", QuickReplyAction.RETRY), StartQuickReplies.CAPABILITIES),
    )

    /** 한 번에 여러 가지를 말했다(DEC-U8-11). 고르지 않고 묻는다 — 임의로 하나를 실행하지 않는다(BR-U8-43). */
    fun oneAtATime(hasTrip: Boolean) = assistant(
        MessageKind.TEXT, "한 번에 하나씩 말씀해 주세요.",
        listOf(CAPABILITIES_ACTION), outcome = "FRAME", quickReplies = StartQuickReplies.of(hasTrip),
    )

    /** 인자 되묻기(BR-U8-11). 문안과 보기는 상대가 인자 이름으로 고른 고정 값이다. */
    fun clarify(argument: String, question: String, options: List<String>) = assistant(
        MessageKind.CLARIFY, question, listOf(CAPABILITIES_ACTION), outcome = "ARGUMENT_CLARIFY",
        payload = mapOf("argument" to argument, "question" to question, "options" to options.ifEmpty { null }),
        quickReplies = options.mapIndexed { i, option -> QuickReply("qr-option-$i", option, QuickReplyAction.PICK_OPTION) },
    )

    /**
     * 버튼 모드 — 해석을 쓰지 않는 상태다(운영자 스위치 off · 계정 일 상한, COST-U8-03). **막지 않고 낮춘다**:
     * 말은 못 알아듣지만 버튼으로는 계속 돕는다.
     */
    fun buttonMode(hasTrip: Boolean) = assistant(
        MessageKind.TEXT, "지금은 아래 버튼으로 도와드릴게요.",
        listOf(CAPABILITIES_ACTION), outcome = "DOWNGRADED", quickReplies = StartQuickReplies.of(hasTrip),
    )
}

/** 폴백 원인(FD §6). 프론트 계약의 `FallbackCause` 와 같은 어휘다. */
enum class FallbackCause(val text: String) {
    AI_UNAVAILABLE("지금 도우미가 응답하지 못했어요."),
    SOURCE_UNAVAILABLE("지금 일부 정보를 확인할 수 없어요."),
}
