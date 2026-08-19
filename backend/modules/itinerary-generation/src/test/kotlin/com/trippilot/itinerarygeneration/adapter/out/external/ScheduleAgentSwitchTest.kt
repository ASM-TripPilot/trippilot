package com.trippilot.itinerarygeneration.adapter.out.external

import com.trippilot.itinerarygeneration.domain.ScheduleAgentPort
import com.trippilot.placedata.api.Area
import com.trippilot.placedata.api.CandidatePoolPort
import com.trippilot.placedata.api.GroundedPlace
import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.types.shouldBeInstanceOf
import org.springframework.boot.autoconfigure.AutoConfigurations
import org.springframework.boot.autoconfigure.context.PropertyPlaceholderAutoConfiguration
import org.springframework.boot.test.context.runner.ApplicationContextRunner
import java.time.Clock
import java.time.Instant
import java.time.ZoneOffset

/**
 * `trippilot.ai.schedule.mode` 가 **실제로 주입되는 포트 구현을 바꾸는지**.
 *
 * 왜 필요한가: 프로퍼티가 잘 바인딩돼도(→ ScheduleAgentPropertiesBindingTest) 조건부 빈이 안 걸리면
 * 여전히 Fake 가 주입된다. 그러면 통합테스트에서 AI 컨테이너를 띄워놓고도 **한 번도 호출하지 않은 채**
 * "전부 정상"으로 보인다 — 가장 나쁜 실패 모드다. 스위치의 유일한 존재 이유가 이 전환이라 여기서 못 박는다.
 */
class ScheduleAgentSwitchTest : StringSpec({

    // 스위치 판정만 보므로 협력자는 최소 스텁 — 호출하지 않는다.
    val clock: Clock = Clock.fixed(Instant.parse("2026-08-11T00:00:00Z"), ZoneOffset.UTC)
    val pool = object : CandidatePoolPort {
        override fun resolve(area: Area, categories: Set<String>): List<GroundedPlace> = emptyList()
        override fun ground(poiIds: List<java.util.UUID>): List<GroundedPlace> = emptyList()
    }

    val runner = ApplicationContextRunner()
        .withConfiguration(AutoConfigurations.of(PropertyPlaceholderAutoConfiguration::class.java))
        .withUserConfiguration(ScheduleAgentConfiguration::class.java)
        .withBean(Clock::class.java, { clock })
        .withBean(CandidatePoolPort::class.java, { pool })
        // 두 어댑터가 공유하는 슬롯 후보 소스 — 스위치 판정에는 안 쓰이지만 주입은 돼야 컨텍스트가 뜬다.
        .withBean(LocalSlotCandidateSource::class.java)
        .withBean(FakeScheduleAgent::class.java)
        .withBean(HttpScheduleAgentAdapter::class.java)

    "기본(미설정)이면 Fake 가 주입된다 — 평소 동작은 그대로다" {
        runner.run { ctx ->
            ctx.getBean(ScheduleAgentPort::class.java).shouldBeInstanceOf<FakeScheduleAgent>()
        }
    }

    "mode=http 면 실 HTTP 어댑터가 이긴다(@Primary) — Fake 빈이 함께 있어도" {
        runner.withPropertyValues(
            "trippilot.ai.schedule.mode=http",
            "trippilot.ai.schedule.base-url=http://ai:8000",
        ).run { ctx ->
            ctx.getBean(ScheduleAgentPort::class.java).shouldBeInstanceOf<HttpScheduleAgentAdapter>()
        }
    }
})
