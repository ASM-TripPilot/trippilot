package com.trippilot.assistant.adapter.out.interpret

import com.trippilot.assistant.application.AssistantConfiguration
import com.trippilot.assistant.domain.DialogueInterpretPort
import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.shouldBe
import io.kotest.matchers.string.shouldContain
import org.springframework.boot.test.context.runner.ApplicationContextRunner

/**
 * 해석 스위치의 배선(REL-U8-06). **운영은 `off` 로 뜬다** — 그 설정으로 컨텍스트가 서는지, 그리고 뜻 없는 값이
 * 조용히 버튼 모드가 되지 않고 기동에서 드러나는지를 잰다. 서비스 테스트는 대역을 직접 넣어서 이 배선을 못 본다.
 */
class DialogueInterpretModeTest : StringSpec({

    val runner = ApplicationContextRunner()
        .withUserConfiguration(AssistantConfiguration::class.java, DialogueInterpretModeGuard::class.java, FakeDialogueInterpreter::class.java)

    "off 면 해석기 없이 뜬다 — 턴은 버튼 모드로 답한다" {
        runner.withPropertyValues("trippilot.assistant.interpret.mode=off").run { context ->
            context.startupFailure shouldBe null
            context.getBeanProvider(DialogueInterpretPort::class.java).ifAvailable shouldBe null
        }
    }

    "fake 와 미설정은 낱말 표 대역으로 뜬다" {
        listOf(runner.withPropertyValues("trippilot.assistant.interpret.mode=fake"), runner).forEach { configured ->
            configured.run { context ->
                context.startupFailure shouldBe null
                (context.getBeanProvider(DialogueInterpretPort::class.java).ifAvailable is FakeDialogueInterpreter) shouldBe true
            }
        }
    }

    "http 는 실 어댑터로 뜬다 (TRIP-1410)" {
        runner.withUserConfiguration(HttpDialogueInterpreterConfiguration::class.java)
            .withPropertyValues("trippilot.assistant.interpret.mode=http").run { context ->
                context.startupFailure shouldBe null
                (context.getBeanProvider(DialogueInterpretPort::class.java).ifAvailable is HttpDialogueInterpreter) shouldBe true
            }
    }

    /** 오타는 어느 빈도 켜지 못한다 — 조용히 버튼 모드가 되면 원인을 못 짚는다. */
    "오타는 기동에서 실패한다" {
        listOf("on", "").forEach { mode ->
            runner.withPropertyValues("trippilot.assistant.interpret.mode=$mode").run { context ->
                (context.startupFailure != null) shouldBe true
                generateSequence(context.startupFailure) { it.cause }.last().message!! shouldContain "지원하지 않습니다"
            }
        }
    }
})
