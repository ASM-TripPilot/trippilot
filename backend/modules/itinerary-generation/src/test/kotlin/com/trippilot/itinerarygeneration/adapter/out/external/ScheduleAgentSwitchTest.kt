package com.trippilot.itinerarygeneration.adapter.out.external

import com.trippilot.itinerarygeneration.domain.ScheduleAgentPort
import com.trippilot.placedata.api.Area
import com.trippilot.placedata.api.CandidatePoolPort
import com.trippilot.placedata.api.GroundedPlace
import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.types.shouldBeInstanceOf
import org.springframework.boot.autoconfigure.AutoConfigurations
import org.springframework.boot.autoconfigure.context.PropertyPlaceholderAutoConfiguration
import com.trippilot.itinerarygeneration.application.GenerationConfiguration
import org.springframework.boot.test.context.runner.ApplicationContextRunner
import io.kotest.matchers.comparables.shouldBeGreaterThan
import io.kotest.matchers.comparables.shouldBeLessThan
import io.kotest.matchers.shouldBe
import org.springframework.web.client.RestClient
import java.time.Duration
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
        // 시한 설정은 조건부 어댑터 설정 **밖**에서 등록된다(기본 fake 모드에도 필요하다) —
        // 슬라이스에서 빼면 실물과 다른 조합을 검증하게 된다.
        .withUserConfiguration(GenerationConfiguration::class.java, ScheduleAgentConfiguration::class.java)
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

    /**
     * **편집은 생성만큼 기다리지 않는다.**
     *
     * 편집(PUT)은 `validate` 를 요청 안에서 동기로 부른다. "AI 가 죽어도 편집은 막지 않는다"가 설계
     * 의도인데(`Revalidation`), 그 회복은 **소켓이 끊긴 다음에야** 작동한다. 생성용 상한(시간제약을
     * 풀면 612초)을 공유하면 AI 가 응답을 멈췄을 때 편집이 10분간 막혀 의도가 뒤집힌다.
     */
    "편집용 클라이언트는 생성용보다 짧은 read 상한을 쓴다" {
        runner.withPropertyValues(
            "trippilot.ai.schedule.mode=http",
            "trippilot.ai.schedule.base-url=http://ai:8000",
        ).run { ctx ->
            val generate = readTimeoutOf(ctx.getBean("scheduleAgentRestClient", RestClient::class.java))
            val bounded = readTimeoutOf(ctx.getBean("scheduleAgentBoundedRestClient", RestClient::class.java))

            // 기본(시한 미전송)에서 생성은 AI 백스톱 600초를 넘겨 기다린다.
            generate shouldBeGreaterThan Duration.ofSeconds(600)
            // 편집은 짧게 끊되, 실측 재검증(약 20초)을 자르지 않을 만큼은 준다.
            bounded shouldBe Duration.ofMillis(62_000)
            bounded shouldBeLessThan generate
        }
    }
})

/** 스프링이 값을 노출하지 않아 반사로 읽는다 — 상한이 실제로 갈렸는지는 이 방법으로만 확인된다. */
private fun readTimeoutOf(client: RestClient): Duration {
    fun field(target: Any, name: String): Any? = generateSequence(target.javaClass) { it.superclass }
        .mapNotNull { c -> runCatching { c.getDeclaredField(name) }.getOrNull() }
        .firstOrNull()?.apply { isAccessible = true }?.get(target)

    val factory = requireNotNull(field(client, "clientRequestFactory") ?: field(client, "requestFactory")) {
        "RestClient 내부 요청 팩토리를 찾지 못했다 — 스프링 구조가 바뀌었으면 이 테스트를 고쳐야 한다."
    }
    return Duration.ofMillis((requireNotNull(field(factory, "readTimeout")) as Number).toLong())
}
