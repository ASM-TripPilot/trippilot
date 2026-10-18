package com.trippilot.assistant.adapter.out.interpret

import com.trippilot.assistant.application.AssistantProperties
import com.trippilot.assistant.application.AssistantTemplates
import com.trippilot.assistant.domain.AnswerKind
import com.trippilot.assistant.domain.DialogueInterpretPort
import com.trippilot.assistant.domain.Intent
import com.trippilot.assistant.domain.IntentFrame
import com.trippilot.assistant.domain.InterpretOutcome
import com.trippilot.assistant.domain.InterpretRequest
import com.trippilot.assistant.domain.Interpretation
import com.trippilot.assistant.domain.InterpretedAnswer
import com.trippilot.assistant.domain.InterpretedQuickReply
import com.trippilot.assistant.domain.QuickReplyAction
import org.slf4j.LoggerFactory
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Configuration
import org.springframework.stereotype.Component

/**
 * 해석 대역(G-U8-4 "페이크 먼저") — 상대의 `/ai/v1/dialogue/interpret` 가 열리기 전에 턴의 흐름을 끝까지 세운다.
 *
 * **말을 알아듣는 척하지 않는다.** 낱말 몇 개를 의도에 맞추는 표일 뿐이고, 표에 없으면 범위 밖이다 —
 * 그럴듯한 해석을 지어내면 기본 모드에서 "되는 것처럼" 보이다가 실 연동에서야 처음 틀린다.
 * LLM 을 쓰지 않으므로 `llmCalls` 는 0 이고, 맥락은 받은 그대로 돌려준다(INV-U8-07).
 *
 * 인사말 하나만 상대처럼 **답을 완성한 `ANSWER`** 로 낸다(assistant-orchestrator 1단계) — 로컬 기본 모드·IT 가 새 모양(문장·빠른 답
 * 발급·프레임 없는 답)을 연습하게. 사실을 지어내지 않는 문장이라 대역에 둘 수 있다.
 */
@Component
@ConditionalOnProperty(name = ["trippilot.assistant.interpret.mode"], havingValue = "fake", matchIfMissing = true)
class FakeDialogueInterpreter : DialogueInterpretPort {

    override fun interpret(request: InterpretRequest): Interpretation {
        if (GREETINGS.any { it in request.utterance }) {
            return Interpretation(
                outcome = InterpretOutcome.ANSWER, frames = emptyList(), clarify = null, dialogueContext = request.dialogueContext, llmCalls = 0,
                answer = InterpretedAnswer(
                    AnswerKind.TEXT, "안녕하세요! ${AssistantTemplates.CAPABILITIES_LINE}", payload = null,
                    nextActions = listOf(AssistantTemplates.CAPABILITIES_ACTION),
                    quickReplies = listOf(InterpretedQuickReply("오늘 날씨", QuickReplyAction.SEND_TEXT, emptyMap())),
                    footnote = null,
                ),
            )
        }
        val intent = KEYWORDS.firstOrNull { (words, _) -> words.any { it in request.utterance } }?.second ?: Intent.OUT_OF_SCOPE
        return Interpretation(
            outcome = if (intent == Intent.OUT_OF_SCOPE) InterpretOutcome.OUT_OF_SCOPE else InterpretOutcome.FRAME,
            frames = listOf(IntentFrame(intent, emptyMap(), matchRoute = "CONFIDENT")),
            clarify = null,
            dialogueContext = request.dialogueContext,
            llmCalls = 0,
        )
    }

    private companion object {
        val GREETINGS = listOf("안녕", "고마워", "고맙")

        /** 앞에서부터 맞춘다 — "다시 짜"가 "짜"보다 먼저 걸려야 한다. */
        val KEYWORDS: List<Pair<List<String>, Intent>> = listOf(
            listOf("검토", "점검") to Intent.SHOW_SCHEDULE,
            listOf("날씨", "비 와", "비와") to Intent.GET_WEATHER,
            listOf("다음 장소", "다음 일정", "다음에 어디") to Intent.GET_NEXT_SLOT,
            listOf("거리", "얼마나 멀") to Intent.GET_DISTANCE,
            listOf("다시 짜", "재계획") to Intent.REPLAN,
            listOf("다시 만들", "새로 만들") to Intent.REGENERATE,
            listOf("대신", "다른 곳", "다른 데") to Intent.SUGGEST_ALTERNATIVE,
            listOf("바꿔", "옮겨", "빼줘", "빼 줘", "추가해") to Intent.EDIT_SCHEDULE,
            listOf("새 여행", "일정 만들", "일정 짜") to Intent.GENERATE_SCHEDULE,
            listOf("회고") to Intent.GENERATE_REFLECTION,
            listOf("요약") to Intent.TRIP_SUMMARY,
            listOf("스타일", "취향 분석") to Intent.STYLE_ANALYSIS,
            listOf("어떤 곳", "어떤 데", "영업시간") to Intent.GET_POI_INFO,
        )
    }
}

/**
 * 해석 스위치의 값 확인(`off`·`fake`·`http`). 오타는 어느 빈도 켜지 못해
 * **조용히 버튼 모드**가 된다. 그 상태로 배포되면 "도우미가 말을 못 알아듣는다"로만 보여 원인을 못 짚는다.
 */
@Configuration
class DialogueInterpretModeGuard {
    @Bean
    fun dialogueInterpretModeCheck(properties: AssistantProperties): Any {
        val mode = properties.interpret.mode
        check(mode in SUPPORTED) {
            "trippilot.assistant.interpret.mode=$mode 는 지원하지 않습니다 — $SUPPORTED 중 하나여야 합니다."
        }
        // 꺼져 있는 것은 사건이 아니라 상태다 — 턴마다 경고하지 않고 기동 때 한 번 알린다.
        log.info("도우미 발화 해석 모드 = {}{}", mode, if (mode == "off") " (버튼 모드 — 말은 해석하지 않고 버튼으로만 돕는다)" else "")
        return mode
    }

    private companion object {
        val SUPPORTED = setOf("off", "fake", "http")
        private val log = LoggerFactory.getLogger(DialogueInterpretModeGuard::class.java)
    }
}
