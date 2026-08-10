package com.trippilot.itinerarygeneration.adapter.out.external

import io.kotest.core.spec.style.StringSpec
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
})
