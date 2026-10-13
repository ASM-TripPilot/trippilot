package com.trippilot.assistant.application

import com.trippilot.assistant.domain.Intent
import com.trippilot.assistant.domain.QuickReply
import com.trippilot.assistant.domain.QuickReplyAction

/**
 * 시트를 열었을 때의 빠른 답(BR-U8-04) — **서버가 발급한다**. 앱이 id 를 지어내면 "발급된 id 만 ACTION 턴으로
 * 받는다"(위조 차단)에 걸린다. 그래서 `내가 할 수 있는 것 보기`도 여기서 늘 하나 준다(프론트 계약 R10).
 *
 * id 는 고정이다 — 메시지에 붙지 않고 세션 응답에 실리는 값이라 저장된 행이 없고, 턴 처리(TRIP-1378)는
 * 이 목록으로 발급 여부를 확인한다. 문구는 프론트가 가짜 서버에 두었던 것과 같다.
 */
object StartQuickReplies {
    /** 빠른 답이 곧장 가리키는 의도 — 이 값이 있으면 해석을 거치지 않는다(COST-U8-07: 빠른 답은 LLM 0회). */
    const val INTENT = "intent"

    /** 의도가 아니라 화면 하나를 여는 빠른 답(숙소 검색 — 숙소 요청은 넘기기다, DEC-U8-10). */
    const val OPEN = "open"

    val CAPABILITIES = QuickReply("qr-capabilities", "내가 할 수 있는 것 보기", QuickReplyAction.SHOW_CAPABILITIES)

    /**
     * 말처럼 보이는 버튼도 **말로 다시 해석하지 않는다.** 해석이 꺼진 버튼 모드(운영 기본값)에서 이 버튼들이
     * "지금은 버튼으로 도와드릴게요"만 되풀이하면 버튼 모드에 쓸 버튼이 없다.
     */
    private val WITH_TRIP = listOf(
        QuickReply("qr-review", "검토해줘", QuickReplyAction.REVIEW),
        QuickReply("qr-next", "다음 장소 어디야", QuickReplyAction.SEND_TEXT, mapOf(INTENT to Intent.GET_NEXT_SLOT.name)),
        QuickReply("qr-weather", "오늘 날씨", QuickReplyAction.SEND_TEXT, mapOf(INTENT to Intent.GET_WEATHER.name)),
        CAPABILITIES,
    )

    /** 여행이 없어도 비활성화하지 않는다(BR-U8-05) — 여행을 만들거나 숙소를 찾는 쪽으로 이끈다. */
    private val WITHOUT_TRIP = listOf(
        QuickReply("qr-new-trip", "새 여행", QuickReplyAction.SEND_TEXT, mapOf(INTENT to Intent.GENERATE_SCHEDULE.name)),
        QuickReply("qr-stay", "숙소 탐색", QuickReplyAction.SEND_TEXT, mapOf(OPEN to "OPEN_STAY_SEARCH")),
        CAPABILITIES,
    )

    fun of(hasTrip: Boolean): List<QuickReply> = if (hasTrip) WITH_TRIP else WITHOUT_TRIP

    /** 이 목록이 발급한 id 인가 — ACTION 턴이 받아도 되는 빠른 답인지 확인한다. */
    fun find(id: String): QuickReply? = (WITH_TRIP + WITHOUT_TRIP).firstOrNull { it.id == id }
}
