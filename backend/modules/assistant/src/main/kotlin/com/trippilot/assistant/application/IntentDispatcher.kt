package com.trippilot.assistant.application

import com.trippilot.assistant.domain.AssistantSurface
import com.trippilot.assistant.domain.Intent
import com.trippilot.assistant.domain.NewMessage
import com.trippilot.assistant.domain.NextAction
import org.springframework.stereotype.Component

/** 처리기가 보는 것 — 여행이 있는가, 여행 중인가, 어느 화면에서 열었는가. 발화 원문은 여기 오지 않는다. */
data class DispatchContext(val hasTrip: Boolean, val inTrip: Boolean, val surface: AssistantSurface)

/**
 * 의도 → 처리기(FD §4 디스패치 표). **의도마다 처리기는 정확히 하나다**(PBT-U8-9) — 표를 `when` 으로 두어
 * 의도가 늘면 컴파일이 빈칸을 잡는다.
 *
 * 대화 안에서 끝내는 것은 조회와 제안뿐이고, 나머지는 기존 화면으로 **넘긴다**. 넘기기는 실행이 아니다 —
 * 앱이 그 화면으로 옮기고, 거기 있는 확인·확정 절차가 그대로 돈다.
 *
 * **지금은 전부 넘기기다.** 조회형(진행 검토·다음 장소·거리·장소·날씨)은 값을 읽어 카드로 답하는 처리기가,
 * 변경형(일정 바꾸기·대체 후보)은 제안 카드가 뒤따라 들어온다(TRIP-1378 조회형 · TRIP-1379). 그때까지도
 * 막다른 응답은 없다 — 그 일을 할 수 있는 화면을 연다.
 */
@Component
class IntentDispatcher {

    fun dispatch(intent: Intent, context: DispatchContext): NewMessage {
        // 일반 대화(여행 없음)에서 일정·동선을 물으면 여행부터 만들게 한다(BR-U8-05) — 넘길 화면이 없다.
        if (intent in NEEDS_TRIP && !context.hasTrip) return AssistantTemplates.needTrip()
        return when (intent) {
            Intent.EDIT_SCHEDULE, Intent.SUGGEST_ALTERNATIVE ->
                AssistantTemplates.handoff("일정은 편집 화면에서 바꿀 수 있어요.", NextAction("OPEN_ITINERARY_EDIT", "직접 편집"))
            Intent.REPLAN ->
                // 재계획은 여행 중에만 있다(FD §4). 그 밖(여행 전·후)에는 다시 만들기로 보낸다.
                if (context.inTrip) {
                    AssistantTemplates.handoff("남은 일정은 다시 짜기에서 바꿀 수 있어요.", NextAction("OPEN_REPLAN", "다시 짜기"))
                } else {
                    AssistantTemplates.handoff("일정은 만들기 화면에서 다시 만들 수 있어요.", NextAction("OPEN_REGENERATE", "일정 다시 만들기"))
                }
            Intent.REGENERATE ->
                AssistantTemplates.handoff("일정은 만들기 화면에서 다시 만들 수 있어요.", NextAction("OPEN_REGENERATE", "일정 다시 만들기"))
            Intent.GENERATE_SCHEDULE ->
                AssistantTemplates.handoff("일정 만들기 화면으로 안내할게요.", NextAction("OPEN_ITINERARY_METHOD", "일정 만들기"))
            Intent.SHOW_SCHEDULE, Intent.GET_DISTANCE, Intent.GET_POI_INFO, Intent.GET_WEATHER ->
                AssistantTemplates.handoff("일정 화면에서 확인할 수 있어요.", NextAction("OPEN_ITINERARY", "일정 보기"))
            Intent.GET_NEXT_SLOT ->
                if (context.inTrip) {
                    AssistantTemplates.handoff("여행 중 화면에서 다음 장소를 볼 수 있어요.", NextAction("OPEN_LIVE", "여행 중 화면 열기"))
                } else {
                    AssistantTemplates.handoff("일정 화면에서 확인할 수 있어요.", NextAction("OPEN_ITINERARY", "일정 보기"))
                }
            Intent.GENERATE_REFLECTION ->
                AssistantTemplates.handoff("회고는 기록 화면에서 만들 수 있어요.", NextAction("OPEN_REFLECTION", "기록 열기"))
            Intent.TRIP_SUMMARY ->
                AssistantTemplates.handoff("여행 요약은 기록 화면에 있어요.", NextAction("OPEN_TRIP_SUMMARY", "여행 요약 보기"))
            Intent.STYLE_ANALYSIS ->
                AssistantTemplates.handoff("여행 스타일은 기록에서 볼 수 있어요.", NextAction("OPEN_STYLE", "내 여행 스타일"))
            Intent.OUT_OF_SCOPE ->
                AssistantTemplates.outOfScope(nearStay = context.surface == AssistantSurface.STAY_SEARCH || context.surface == AssistantSurface.STAY_DETAIL)
        }
    }

    private companion object {
        /** 여행이 있어야 넘길 화면이 있는 의도. 스타일 분석과 범위 밖은 여행 없이도 답한다. */
        val NEEDS_TRIP = Intent.entries.toSet() - setOf(Intent.STYLE_ANALYSIS, Intent.OUT_OF_SCOPE)
    }
}
