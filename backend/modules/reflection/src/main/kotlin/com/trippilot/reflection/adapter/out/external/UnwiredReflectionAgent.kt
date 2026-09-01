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
    fun httpReflectionAgent(properties: ReflectionAgentProperties, clock: Clock): ReflectionAgentPort =
        HttpReflectionAgentAdapter(client(properties), properties, clock)

    /**
     * 경계 매퍼를 **메시지 컨버터에 심는다** — 기본 컨버터를 쓰면 snake_case 가 아니라 요청이 통째로
     * 422 가 된다. 이름 규칙은 계약이지 취향이 아니다.
     */
    private fun client(properties: ReflectionAgentProperties): RestClient =
        RestClient.builder()
            .baseUrl(properties.baseUrl)
            .requestFactory(
                SimpleClientHttpRequestFactory().apply {
                    setConnectTimeout(Duration.ofMillis(properties.connectTimeoutMs))
                    setReadTimeout(Duration.ofMillis(properties.readTimeoutMs))
                },
            )
            .messageConverters { it.add(0, JacksonJsonHttpMessageConverter(ReflectionBoundaryMapper.create())) }
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

    private companion object {
        private val log = LoggerFactory.getLogger(ReflectionAgentConfiguration::class.java)
    }
}
