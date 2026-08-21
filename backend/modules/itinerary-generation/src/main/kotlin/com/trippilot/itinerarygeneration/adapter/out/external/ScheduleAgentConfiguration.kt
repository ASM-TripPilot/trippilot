package com.trippilot.itinerarygeneration.adapter.out.external

import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty
import com.trippilot.itinerarygeneration.application.ScheduleDeadlineProperties
import org.springframework.boot.context.properties.EnableConfigurationProperties
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Configuration
import org.springframework.http.client.SimpleClientHttpRequestFactory
import org.springframework.http.converter.json.JacksonJsonHttpMessageConverter
import org.springframework.web.client.RestClient
import tools.jackson.databind.PropertyNamingStrategies
import tools.jackson.databind.json.JsonMapper
import tools.jackson.module.kotlin.KotlinModule
import java.time.Duration

/**
 * AI 일정 생성 서비스 연동 설정(TRIP-229) — **http 모드에서만 활성**.
 *
 * 격리 원칙(리뷰 반영):
 * - 공유 `RestClient.Builder` 빈을 쓰지 않는다. auth 모듈이 같은 이름·타입 빈을 `@ConditionalOnMissingBean` 으로
 *   노출하는데 그 빌더는 in-place 변형이라, 여기서 baseUrl·requestFactory·컨버터를 붙이면 OAuth 클라이언트가 오염된다.
 *   → 이 설정 안에서 **전용 빌더를 새로 만든다**.
 * - snake_case 컨버터를 **빈으로 노출하지 않는다**. 컨텍스트의 모든 HttpMessageConverter 빈은 MVC 컨버터 목록에도
 *   주입되므로, 노출하면 공개 API 응답(camelCase)이 snake_case 로 바뀔 수 있다. → 로컬 인스턴스로만 사용.
 * - 설정 전체가 조건부라 기본(fake) 모드에서는 빈 자체가 생성되지 않는다.
 */
@Configuration
@EnableConfigurationProperties(ScheduleAgentProperties::class)
@ConditionalOnProperty(name = ["trippilot.ai.schedule.mode"], havingValue = "http")
class ScheduleAgentConfiguration {

    @Bean
    fun scheduleAgentRestClient(
        properties: ScheduleAgentProperties,
        deadlines: ScheduleDeadlineProperties,
    ): RestClient =
        RestClient.builder() // 전용 빌더(공유 빈 미사용)
            .baseUrl(properties.baseUrl)
            .requestFactory(
                SimpleClientHttpRequestFactory().apply {
                    setConnectTimeout(Duration.ofMillis(properties.connectTimeoutMs))
                    // 소켓 read 1회 상한 = **기다려 주기로 한 시간** + 마진.
                    // 시한을 안 걸 때(기본)는 그 시간이 20초가 아니라 610초다 — 예전 산식을 그대로 두면
                    // 우리가 22초에 먼저 끊어, 시간제약을 푼 의미가 사라지고 증상은 "전부 폴백"으로만 보인다.
                    setReadTimeout(Duration.ofMillis(deadlines.waitCeilingMs + properties.readTimeoutMarginMs))
                },
            )
            .messageConverters { it.add(0, JacksonJsonHttpMessageConverter(boundaryMapper())) }
            .build()

    companion object {
        /**
         * AI 경계 전용 매퍼 — snake_case + Kotlin 데이터클래스. **앱 기본 매퍼와 무관하게 독립 생성**(공개 API 영향 없음).
         *
         * 수신형은 [AiScheduleResponse] 계열 와이어 타입이지만, **생성 요청은 도메인 타입
         * ([com.trippilot.itinerarygeneration.domain.ScheduleAgentInput])을 그대로 직렬화한다** — 즉 그쪽 필드명이
         * 곧 와이어 이름이다. 도메인 리팩터가 조용히 계약을 깨는 자리라 `AiBoundaryOpenApiTest` 가 지킨다(TRIP-334).
         */
        fun boundaryMapper(): JsonMapper = JsonMapper.builder()
            .addModule(KotlinModule.Builder().build())
            .propertyNamingStrategy(PropertyNamingStrategies.SNAKE_CASE)
            .build()
    }
}
