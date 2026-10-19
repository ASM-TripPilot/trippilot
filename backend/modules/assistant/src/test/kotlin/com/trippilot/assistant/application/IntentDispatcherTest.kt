package com.trippilot.assistant.application

import com.trippilot.assistant.domain.AssistantSurface
import com.trippilot.assistant.domain.Intent
import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.shouldBe
import java.time.Instant
import java.time.LocalDate
import java.util.UUID

/**
 * 넘기기 문장(FD §4) — AI 결정론 템플릿(`ai/src/trippilot/llm_gateway/workers/dialogue_answer.py` `_ANSWER_TEXT`)과
 * **한 벌**이다(DEC-U8-6). 오케스트레이터가 켜져 있으면 AI 가, 꺼져 있으면 여기가 같은 말을 한다 — 한쪽만 바꾸면 같은 요청의
 * 말투가 스위치 상태에 따라 갈린다. 안내 한 문장 + 아래 버튼으로 이끄는 제안이다(2026-10-19 친근한 말투).
 */
class IntentDispatcherTest : StringSpec({

    val acc = UUID.randomUUID()
    val day = LocalDate.parse("2026-11-01")

    fun ctx(inTrip: Boolean) = DispatchContext(
        acc, UUID.randomUUID(), TripContext(listOf("부산"), 1, null, day, day.plusDays(1)), inTrip, AssistantSurface.ITINERARY,
        emptyMap(), Instant.parse("2026-11-01T03:00:00Z"),
    )

    "넘기기 문장은 AI 템플릿과 한 벌이다 — 재계획은 여행 중에만, 그 밖에는 다시 만들기 문장" {
        val dispatch = dispatcher(FakeTripData(acc))
        listOf(
            Triple(Intent.GENERATE_SCHEDULE, false, "일정 만들기 화면으로 안내해 드릴게요. 아래 버튼을 누르면 바로 시작해요."),
            Triple(Intent.REGENERATE, false, "일정은 만들기 화면에서 다시 만들 수 있어요. 아래 버튼을 누르면 바로 시작해요."),
            Triple(Intent.REPLAN, true, "남은 일정은 다시 짜기에서 지금 상황에 맞게 바꿀 수 있어요. 아래 버튼을 누르면 바로 시작해요."),
            Triple(Intent.REPLAN, false, "일정은 만들기 화면에서 다시 만들 수 있어요. 아래 버튼을 누르면 바로 시작해요."),
            Triple(Intent.GENERATE_REFLECTION, false, "회고는 기록 화면에서 만들 수 있어요. 아래 버튼을 누르면 기록이 열려요."),
            Triple(Intent.TRIP_SUMMARY, false, "여행 요약은 기록 화면에서 볼 수 있어요. 아래 버튼을 누르면 바로 열려요."),
            Triple(Intent.STYLE_ANALYSIS, false, "여행 스타일은 기록에서 볼 수 있어요. 아래 버튼을 누르면 바로 열려요."),
        ).forEach { (intent, inTrip, text) ->
            val message = dispatch.dispatch(intent, ctx(inTrip))
            message.text shouldBe text
            message.nextActions.size shouldBe 1 // "아래 버튼"이 가리키는 것이 정확히 하나다
        }
    }

    "장소 탐색은 여행 없이도 처리기가 답한다 — 상대가 꺼진 대역 모드에서는 못 찾는다고 말하고 능력 안내로 잇는다" {
        val dispatch = dispatcher(FakeTripData(acc))
        val noTrip = ctx(false).copy(tripId = null, trip = null)
        val message = dispatch.dispatch(Intent.EXPLORE_PLACES, noTrip)
        message.text shouldBe "가 볼 만한 곳 찾기는 지금 도와드리기 어려워요. 아래 버튼에서 제가 할 수 있는 걸 확인해 보세요."
        message.nextActions.map { it.type } shouldBe listOf("SHOW_CAPABILITIES")
    }
})
