package com.trippilot.itinerarygeneration.adapter.out.external

import com.trippilot.itinerarygeneration.application.ScheduleDeadlineProperties
import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.comparables.shouldBeGreaterThan
import io.kotest.matchers.shouldBe
import org.springframework.boot.context.properties.bind.Binder
import org.springframework.core.env.StandardEnvironment
import org.springframework.core.env.SystemEnvironmentPropertySource

/**
 * compose 가 넘기는 **환경변수 이름**이 실제로 프로퍼티에 붙는지.
 *
 * 왜 필요한가: 이름이 안 붙어도 앱은 기본값(`fake` · `localhost:8000`)으로 **정상 기동한다**.
 * 그래서 통합테스트에서 "AI 를 붙였는데 전부 폴백"이 나도 원인이 우리 쪽 미배선인지
 * AI 장애인지 구분되지 않는다 — 그 침묵을 여기서 막는다.
 * 특히 `base-url` 은 대시가 있어 스프링 완화 바인딩이 **대시를 지운 이름**을 기대한다.
 */
class ScheduleAgentPropertiesBindingTest : StringSpec({

    fun bind(vararg env: Pair<String, String>): ScheduleAgentProperties {
        val environment = StandardEnvironment()
        environment.propertySources.addFirst(
            SystemEnvironmentPropertySource("test-env", mapOf(*env)),
        )
        return Binder.get(environment)
            .bind("trippilot.ai.schedule", ScheduleAgentProperties::class.java)
            .orElseGet { ScheduleAgentProperties() }
    }

    "compose 가 쓰는 환경변수 이름이 그대로 바인딩된다" {
        val p = bind(
            "TRIPPILOT_AI_SCHEDULE_MODE" to "http",
            "TRIPPILOT_AI_SCHEDULE_BASE_URL" to "http://ai:8000",
        )
        p.mode shouldBe "http"
        p.baseUrl shouldBe "http://ai:8000"
    }

    "미설정이면 기본값 — 평소 기동은 fake 로 남는다" {
        val p = bind()
        p.mode shouldBe "fake"
    }

    fun bindDeadlines(vararg env: Pair<String, String>): ScheduleDeadlineProperties {
        val environment = StandardEnvironment()
        environment.propertySources.addFirst(SystemEnvironmentPropertySource("test-env", mapOf(*env)))
        return Binder.get(environment)
            .bind("trippilot.ai.schedule.deadline", ScheduleDeadlineProperties::class.java)
            .orElseGet { ScheduleDeadlineProperties() }
    }

    /**
     * **시한도 compose 로 넘어온다.** `day1Ms` 는 숫자가 섞여 완화 바인딩이 기대하는 이름
     * (`..._DAY1_MS`)이 눈으로 자명하지 않다 — 안 붙으면 조용히 기본값으로 남고, 증상은
     * "값을 올렸는데 아무것도 안 변한다"라 원인이 안 보인다.
     */
    "시한 값과 플래그가 compose 환경변수 이름으로 바인딩된다" {
        val p = bindDeadlines(
            "TRIPPILOT_AI_SCHEDULE_DEADLINE_ENFORCED" to "true",
            "TRIPPILOT_AI_SCHEDULE_DEADLINE_DAY1_MS" to "30000",
            "TRIPPILOT_AI_SCHEDULE_DEADLINE_TOTAL_MS" to "90000",
        )
        p.enforced shouldBe true
        p.day1Ms shouldBe 30_000L
        p.totalMs shouldBe 90_000L
    }

    /**
     * 값을 올리면 **기다려 주는 시간이 함께 올라간다** — 시한만 올리고 소켓이 먼저 끊는
     * 절반 설정이 생기지 않는다. 멈춘 생성 기준은 그보다 항상 크다(하한 5분이 있어 더 클 수도 있다).
     */
    "시한을 올리면 대기 상한이 따라 올라가고 판정 기준은 그보다 크다" {
        val p = bindDeadlines(
            "TRIPPILOT_AI_SCHEDULE_DEADLINE_ENFORCED" to "true",
            "TRIPPILOT_AI_SCHEDULE_DEADLINE_TOTAL_MS" to "90000",
        )
        p.waitCeilingMs shouldBe 90_000L
        p.staleAfter shouldBeGreaterThan java.time.Duration.ofMillis(p.waitCeilingMs)
    }

    "미설정이면 시한을 싣지 않는다 — 배포 기본" {
        val p = bindDeadlines()
        p.enforced shouldBe false
        p.day1Budget() shouldBe null
    }
})
