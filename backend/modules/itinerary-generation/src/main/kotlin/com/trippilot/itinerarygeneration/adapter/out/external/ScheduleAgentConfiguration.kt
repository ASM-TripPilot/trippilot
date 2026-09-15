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
    ): RestClient = client(properties, deadlines.waitCeilingMs + properties.readTimeoutMarginMs)

    /**
     * **짧게 끊는 클라이언트** — 편집 재검증(validate)·최소수리(repair)용.
     *
     * 이 둘은 사용자의 편집 요청 **안에서 동기로** 돈다. 편집은 "AI 가 죽어도 막지 않는다"가 설계 의도인데
     * ([com.trippilot.itinerarygeneration.application.Revalidation]), 그 회복은 **소켓이 끊긴 다음에야** 작동한다.
     * 생성용 상한(시간제약 해제 시 612초)을 그대로 쓰면 AI 가 응답을 멈췄을 때 편집이 10분간 막힌다 —
     * 막지 않겠다는 의도가 뒤집힌다. 값의 근거는 [ScheduleDeadlineProperties.editWait] 에 있다.
     */
    @Bean
    fun scheduleAgentBoundedRestClient(
        properties: ScheduleAgentProperties,
        deadlines: ScheduleDeadlineProperties,
    ): RestClient = client(properties, deadlines.editWait.toMillis() + properties.readTimeoutMarginMs)

    internal fun client(properties: ScheduleAgentProperties, readTimeoutMs: Long): RestClient =
        RestClient.builder() // 전용 빌더(공유 빈 미사용)
            .baseUrl(properties.baseUrl)
            .requestFactory(
                SimpleClientHttpRequestFactory().apply {
                    setConnectTimeout(Duration.ofMillis(properties.connectTimeoutMs))
                    setReadTimeout(Duration.ofMillis(readTimeoutMs))
                },
            )
            .messageConverters { it.add(0, JacksonJsonHttpMessageConverter(boundaryMapper())) }
            // 비어 있으면 **붙이지 않는다.** 빈 값으로 실으면 상대가 "제시됐는데 틀림"으로 읽어
            // 거부 사유가 '잘못된 토큰'이 되고, 진짜 원인(미설정)이 로그에서 사라진다.
            // `apply { }` 를 쓰지 않는다 — `RestClient.Builder` 에 동명의 멤버(Consumer 인자)가 있어
            // 코틀린 스코프 함수가 아니라 그쪽이 잡히고, 람다 안의 `this` 가 빌더가 아니게 된다.
            .let { builder ->
                if (properties.serviceToken.isBlank()) builder
                else builder.defaultHeader(SERVICE_TOKEN_HEADER, properties.serviceToken)
            }
            .build()

    companion object {
        /**
         * 발신 서비스 자격증명 헤더(TRIP-856). 역방향([com.trippilot.security.ServiceTokenAuthFilter])과
         * **같은 문자열이지만 공유 상수로 묶지 않는다** — 저쪽은 우리가 받는 계약이고 이쪽은 상대(AI)가
         * 받는 계약이라, 검증자가 다르다. 한 상수로 묶으면 없는 연동을 주장하게 되고, 상대가 이름을
         * 바꾸면 우리 수신 경계까지 딸려 움직인다.
         *
         * **토큰이 없으면 막지 않는다(fail-open).** 반대로 가면 토큰을 안 넣은 로컬·CI 에서 `generate`
         * 자체가 죽는다 — 지금 이 채널은 애초에 무인증이라, 잠그는 판단은 상대가 검증을 켜는 시점에
         * 함께 해야 한다. 미설정은 [ScheduleAgentModeAnnouncer] 가 기동 로그로 드러낸다.
         */
        const val SERVICE_TOKEN_HEADER = "X-Service-Token"

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
