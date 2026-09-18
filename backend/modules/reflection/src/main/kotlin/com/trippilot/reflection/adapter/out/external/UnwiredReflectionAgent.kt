package com.trippilot.reflection.adapter.out.external

import com.trippilot.reflection.domain.ReflectionCard
import com.trippilot.reflection.domain.port.ReflectionAgentInput
import com.trippilot.reflection.domain.port.ReflectionAgentPort
import org.slf4j.LoggerFactory
import org.springframework.boot.autoconfigure.condition.ConditionalOnMissingBean
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty
import org.springframework.boot.context.properties.EnableConfigurationProperties
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Configuration
import org.springframework.http.client.SimpleClientHttpRequestFactory
import org.springframework.http.converter.json.JacksonJsonHttpMessageConverter
import org.springframework.web.client.RestClient
import java.time.Clock
import java.time.Duration

/**
 * 기본 구현 — **아직 배선하지 않았다**를 값으로 말한다(`null` → 규칙 카드).
 *
 * "Fake"라 부르지 않는 이유: 일정 쪽 `FakeScheduleAgent` 는 그럴듯한 산출물을 만들어 로컬 개발을
 * 돌게 하는 물건이다. 여기서 그렇게 하면 **가짜 AI 카드가 `source=AI` 로 저장되어** 품질 관측
 * (BR-U5-33)이 거짓이 된다. 회고는 규칙 카드만으로도 화면이 돌기 때문에 지어낼 이유가 없다.
 *
 * 실 구현(HTTP)은 칸 3에서 이 자리를 대체한다.
 */
@Configuration
@EnableConfigurationProperties(ReflectionAgentProperties::class)
class ReflectionAgentConfiguration {

    /**
     * 실 경계 — `trippilot.ai.reflection.mode=http` 일 때만 선다(O-U5-6).
     *
     * 이 빈이 서면 아래 미배선 구현은 `@ConditionalOnMissingBean` 이라 물러난다. 반대로 켜지 않은
     * 환경에서는 이 클래스가 아예 조립되지 않아 **RestClient·설정이 없어도 앱이 뜬다.**
     */
    @Bean
    @ConditionalOnProperty(name = ["trippilot.ai.reflection.mode"], havingValue = "http")
    fun httpReflectionAgent(properties: ReflectionAgentProperties, clock: Clock): ReflectionAgentPort {
        // 일정 쪽 [ScheduleAgentModeAnnouncer] 에 해당하는 자리 — 회고에는 전용 announcer 가 없어 여기서 알린다.
        // 이 빈은 http 모드에서만 서므로 "실 AI 를 켰는데 자격증명이 없다"는 상황에서만 찍힌다.
        if (properties.serviceToken.isBlank()) {
            log.warn(
                "회고 AI 를 실 호출(http)로 켰는데 서비스 토큰이 비어 있습니다(SERVICE_AUTH_TOKEN) — " +
                    "{} 헤더 없이 나갑니다. 상대가 검증을 켜면 거부됩니다(TRIP-856).",
                SERVICE_TOKEN_HEADER,
            )
        }
        return HttpReflectionAgentAdapter(client(properties), properties, clock)
    }

    /**
     * 경계 매퍼를 **메시지 컨버터에 심는다** — 기본 컨버터를 쓰면 snake_case 가 아니라 요청이 통째로
     * 422 가 된다. 이름 규칙은 계약이지 취향이 아니다.
     */
    internal fun client(properties: ReflectionAgentProperties): RestClient =
        RestClient.builder()
            .baseUrl(properties.baseUrl)
            .requestFactory(
                SimpleClientHttpRequestFactory().apply {
                    setConnectTimeout(Duration.ofMillis(properties.connectTimeoutMs))
                    setReadTimeout(Duration.ofMillis(properties.readTimeoutMs))
                },
            )
            .messageConverters { it.add(0, JacksonJsonHttpMessageConverter(ReflectionBoundaryMapper.create())) }
            // 빈 값으로 싣지 않는 이유는 일정 쪽과 같다 — 미설정이 '틀린 토큰'으로 둔갑한다.
            // `apply { }` 금지: `RestClient.Builder` 의 동명 멤버가 잡혀 `this` 가 빌더가 아니게 된다.
            .let { builder ->
                if (properties.serviceToken.isBlank()) builder
                else builder.defaultHeader(SERVICE_TOKEN_HEADER, properties.serviceToken)
            }
            .build()

    @Bean
    @ConditionalOnMissingBean(ReflectionAgentPort::class)
    fun unwiredReflectionAgent(): ReflectionAgentPort = object : ReflectionAgentPort {
        override val enabled = false

        override fun generate(input: ReflectionAgentInput): ReflectionCard? {
            // 침묵하지 않는다(INV-4) — 다만 요청마다 찍으면 로그가 무의미해지므로 debug 다.
            log.debug("회고 AI 경계 미배선 — 규칙 카드로 갑니다. kind={} 방문={}곳", input.kind, input.visits.size)
            return null
        }
    }

    companion object {
        /**
         * 발신 서비스 자격증명 헤더(TRIP-856) — 일정 경계와 같은 이름·같은 시크릿을 쓴다.
         * 두 경계가 같은 상대(AI 서비스) 한 곳을 부르므로 토큰을 갈라 둘 이유가 없다.
         * 상수를 모듈 간 공유하지 않는 근거는 `ScheduleAgentConfiguration.SERVICE_TOKEN_HEADER` 쪽에 적었다.
         */
        const val SERVICE_TOKEN_HEADER = "X-Service-Token"

        private val log = LoggerFactory.getLogger(ReflectionAgentConfiguration::class.java)
    }
}
