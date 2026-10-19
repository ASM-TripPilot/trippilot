package com.trippilot.assistant.application

import com.trippilot.assistant.domain.AssistantSurface
import com.trippilot.assistant.domain.Intent
import com.trippilot.assistant.domain.NewMessage
import com.trippilot.assistant.domain.NextAction
import org.springframework.stereotype.Component
import java.time.Instant
import java.util.UUID

/**
 * 처리기가 보는 것. 해석이 뽑은 인자([arguments])는 저장된 값을 **찾는 데만** 쓴다.
 *
 * @property trip 소유가 확인된 여행. null 이면 여행 없는 대화다.
 * @property utterance 사용자가 한 말(검사를 통과한 것). **일정 변경 제안만 읽는다** — 편집 경계가 말을 받아 편집으로 옮기기
 *   때문이다. 화면에 그리지도 로그에 남기지도 않는다(SEC-U8-06). 버튼을 눌러 온 턴이면 null.
 * @property deadlineMs 이 턴에 남은 시간 중 상대 호출 하나에 줄 수 있는 몫(PERF-U8-01·02).
 */
data class DispatchContext(
    val accountId: UUID,
    val tripId: UUID?,
    val trip: TripContext?,
    val inTrip: Boolean,
    val surface: AssistantSurface,
    val arguments: Map<String, String>,
    val now: Instant,
    val utterance: String? = null,
    val deadlineMs: Long = 0,
) {
    val hasTrip: Boolean get() = trip != null && tripId != null
}

/**
 * 의도 → 처리기(FD §4 디스패치 표). **의도마다 처리기는 정확히 하나다**(PBT-U8-9) — 표를 `when` 으로 두어
 * 의도가 늘면 컴파일이 빈칸을 잡는다.
 *
 * 대화 안에서 끝내는 것은 조회와 제안뿐이고, 나머지는 기존 화면으로 **넘긴다**. 넘기기는 실행이 아니다 —
 * 앱이 그 화면으로 옮기고, 거기 있는 확인·확정 절차가 그대로 돈다. 넘기기 문장은 안내 한 문장 + 아래 버튼으로 이끄는 제안이고,
 * AI 결정론 템플릿(`ai/src/trippilot/llm_gateway/workers/dialogue_answer.py` `_ANSWER_TEXT`)과 **같은 문장**이다(한 벌 — 2026-10-19).
 *
 * 조회형(진행 검토·다음 장소·거리·장소·날씨)은 [QueryCards] 가 저장된 값으로 답한다. 변경형(일정 바꾸기·대체 후보)은
 * [ProposalCards] 가 **제안**으로 답한다 — 저장은 사용자가 [적용]을 누를 때뿐이다(BR-U8-30). 어느 쪽도 막다른 응답은 없다.
 */
@Component
class IntentDispatcher(private val cards: QueryCards, private val proposals: ProposalCards) {

    fun dispatch(intent: Intent, context: DispatchContext): NewMessage {
        // 일반 대화(여행 없음)에서 일정·동선을 물으면 여행부터 만들게 한다(BR-U8-05) — 넘길 화면이 없다.
        if (intent in NEEDS_TRIP && !context.hasTrip) return AssistantTemplates.needTrip()
        return when (intent) {
            Intent.EDIT_SCHEDULE -> proposals.edit(context)
            Intent.SUGGEST_ALTERNATIVE -> proposals.alternatives(context)
            Intent.REPLAN ->
                // 재계획은 여행 중에만 있다(FD §4). 그 밖(여행 전·후)에는 다시 만들기로 보낸다.
                if (context.inTrip) {
                    AssistantTemplates.handoff("남은 일정은 다시 짜기에서 지금 상황에 맞게 바꿀 수 있어요. 아래 버튼을 눌러 볼까요?", NextAction("OPEN_REPLAN", "다시 짜기"))
                } else {
                    AssistantTemplates.handoff("일정은 만들기 화면에서 다시 만들 수 있어요. 아래 버튼을 눌러 볼까요?", NextAction("OPEN_REGENERATE", "일정 다시 만들기"))
                }
            Intent.REGENERATE ->
                AssistantTemplates.handoff("일정은 만들기 화면에서 다시 만들 수 있어요. 아래 버튼을 눌러 볼까요?", NextAction("OPEN_REGENERATE", "일정 다시 만들기"))
            Intent.GENERATE_SCHEDULE ->
                AssistantTemplates.handoff("일정 만들기 화면으로 안내해 드릴게요. 아래 버튼을 눌러 바로 시작해 볼까요?", NextAction("OPEN_ITINERARY_METHOD", "일정 만들기"))
            Intent.SHOW_SCHEDULE -> cards.review(context)
            Intent.GET_NEXT_SLOT -> cards.nextSlot(context)
            Intent.GET_DISTANCE -> cards.distance(context)
            Intent.GET_POI_INFO -> cards.place(context)
            Intent.GET_WEATHER -> cards.weather(context)
            Intent.GENERATE_REFLECTION ->
                AssistantTemplates.handoff("회고는 기록 화면에서 만들 수 있어요. 아래 버튼으로 기록을 열어 볼까요?", NextAction("OPEN_REFLECTION", "기록 열기"))
            Intent.TRIP_SUMMARY ->
                AssistantTemplates.handoff("여행 요약은 기록 화면에서 볼 수 있어요. 아래 버튼으로 바로 열어 볼까요?", NextAction("OPEN_TRIP_SUMMARY", "여행 요약 보기"))
            Intent.STYLE_ANALYSIS ->
                AssistantTemplates.handoff("여행 스타일은 기록에서 볼 수 있어요. 아래 버튼으로 바로 확인해 볼까요?", NextAction("OPEN_STYLE", "내 여행 스타일"))
            Intent.OUT_OF_SCOPE ->
                AssistantTemplates.outOfScope(nearStay = context.surface == AssistantSurface.STAY_SEARCH || context.surface == AssistantSurface.STAY_DETAIL)
        }
    }

    private companion object {
        /** 여행이 있어야 넘길 화면이 있는 의도. 스타일 분석과 범위 밖은 여행 없이도 답한다. */
        val NEEDS_TRIP = Intent.entries.toSet() - setOf(Intent.STYLE_ANALYSIS, Intent.OUT_OF_SCOPE)
    }
}
