package com.trippilot.itinerarygeneration.adapter.out.external

import org.springframework.boot.autoconfigure.condition.ConditionalOnMissingBean
import org.springframework.boot.context.properties.EnableConfigurationProperties
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Configuration
import org.springframework.http.client.SimpleClientHttpRequestFactory
import org.springframework.http.converter.json.JacksonJsonHttpMessageConverter
import org.springframework.web.client.RestClient
import tools.jackson.databind.ObjectMapper
import tools.jackson.databind.PropertyNamingStrategies
import tools.jackson.databind.json.JsonMapper
import tools.jackson.module.kotlin.KotlinModule
import java.time.Duration

/**
 * AI 일정 생성 서비스 연동 설정(TRIP-229). **snake_case 매핑은 백엔드 소유**(경계 계약) — 앱 기본 매퍼
 * (camelCase, 공개 API 용)와 분리된 전용 매퍼를 이 클라이언트에만 붙인다(SB4 기본 = Jackson 3).
 * 타임아웃은 상한 안전장치 — 실제 시한은 AI 가 `deadline_ms` 로 자체 관리하고 백엔드는 네트워크 홉 마진만 더한다.
 */
@Configuration
@EnableConfigurationProperties(ScheduleAgentProperties::class)
class ScheduleAgentConfiguration {

    /** SB4.0 은 RestClient.Builder 를 자동 노출하지 않아 명시 제공(이미 있으면 유지 — auth 모듈과 동일 관례). */
    @Bean
    @ConditionalOnMissingBean
    fun restClientBuilder(): RestClient.Builder = RestClient.builder()

    /**
     * AI 경계 전용 JSON 컨버터 — snake_case. 앱 기본 매퍼를 rebuild 해 **모듈 구성(시간·Kotlin 등)은 물려받고
     * 이름 전략만** 바꾼다(경계에서만 snake_case, 공개 API 는 camelCase 유지).
     */
    @Bean
    fun scheduleAgentJsonConverter(objectMapper: ObjectMapper): JacksonJsonHttpMessageConverter =
        JacksonJsonHttpMessageConverter(snakeCase(objectMapper))

    @Bean
    fun scheduleAgentRestClient(
        properties: ScheduleAgentProperties,
        builder: RestClient.Builder,
        scheduleAgentJsonConverter: JacksonJsonHttpMessageConverter,
    ): RestClient = builder
        .baseUrl(properties.baseUrl)
        .requestFactory(
            SimpleClientHttpRequestFactory().apply {
                setConnectTimeout(Duration.ofMillis(properties.connectTimeoutMs))
                // read-timeout = AI 최대 시한 + 네트워크 홉 마진(AI deadline 은 내부 계산 예산이라 홉이 빠져 있음).
                setReadTimeout(Duration.ofMillis(properties.maxDeadlineMs + properties.readTimeoutMarginMs))
            },
        )
        // index 0 — 기본 컨버터(camelCase)보다 먼저 매칭되게.
        .messageConverters { it.add(0, scheduleAgentJsonConverter) }
        .build()

    companion object {
        /**
         * 경계 매퍼 — 이름 전략(snake_case) + Kotlin 데이터클래스 지원. 설정·테스트 공용.
         * base 의 모듈 구성을 물려받고, Kotlin 모듈은 명시 등록한다(중복 등록은 Jackson 이 무시).
         */
        fun snakeCase(base: ObjectMapper): JsonMapper =
            (base as JsonMapper).rebuild()
                .addModule(KotlinModule.Builder().build())
                .propertyNamingStrategy(PropertyNamingStrategies.SNAKE_CASE)
                .build()
    }
}
