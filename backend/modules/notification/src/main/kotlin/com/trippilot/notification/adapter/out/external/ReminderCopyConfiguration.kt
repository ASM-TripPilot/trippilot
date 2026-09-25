package com.trippilot.notification.adapter.out.external

import com.trippilot.notification.domain.ReminderCopy
import com.trippilot.notification.domain.ReminderCopyPort
import com.trippilot.notification.domain.ReminderCopyRequest
import org.slf4j.LoggerFactory
import org.springframework.boot.autoconfigure.condition.ConditionalOnMissingBean
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty
import org.springframework.boot.context.properties.ConfigurationProperties
import org.springframework.boot.context.properties.EnableConfigurationProperties
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Configuration
import org.springframework.http.client.SimpleClientHttpRequestFactory
import org.springframework.http.converter.json.JacksonJsonHttpMessageConverter
import org.springframework.web.client.RestClient
import tools.jackson.databind.PropertyNamingStrategies
import tools.jackson.databind.json.JsonMapper
import tools.jackson.module.kotlin.KotlinModule
import java.time.Clock
import java.time.Duration

/**
 * 리마인드 문구 경계 설정(TRIP-836).
 *
 * [mode]=`off`(기본)면 아래 미배선 구현이 물려 **항상 상수 문구**로 간다. `http` 면 실 호출.
 * 기본이 꺼짐인 이유는 회고(`mode=rule`)와 같다 — 안 켠 환경에서 리마인드가 죽지 않는 것이 더 중요하다.
 */
@ConfigurationProperties(prefix = "trippilot.ai.reminder-copy")
data class ReminderCopyProperties(
    val mode: String = "off",
    val baseUrl: String = "http://localhost:8000",
    val connectTimeoutMs: Long = 3_000,
    /** `request_meta.deadline_ms` 로 상대에 실린다. */
    val deadlineMs: Long = 8_000,
    val readTimeoutMs: Long = 14_000,
    /** 발신 서비스 자격증명(TRIP-856). 비면 헤더를 안 싣고 호출은 그대로 나간다. */
    val serviceToken: String = "",
) {
    init {
        require(readTimeoutMs >= deadlineMs + AI_BACKSTOP_MARGIN_MS) {
            "readTimeoutMs($readTimeoutMs)는 마감+백스톱(${deadlineMs + AI_BACKSTOP_MARGIN_MS})보다 " +
                "작을 수 없습니다 — 상대가 마감을 넘겨 정리하는 응답을 우리가 먼저 끊게 됩니다."
        }
    }

    companion object {
        /** 상대 `timeout_backstop` = deadline_ms + 5s. 회고 경계에서 실측한 값과 같다. */
        const val AI_BACKSTOP_MARGIN_MS = 5_000L
    }
}

@Configuration
@EnableConfigurationProperties(ReminderCopyProperties::class)
class ReminderCopyConfiguration {

    @Bean
    @ConditionalOnProperty(name = ["trippilot.ai.reminder-copy.mode"], havingValue = "http")
    fun httpReminderCopy(properties: ReminderCopyProperties, clock: Clock): ReminderCopyPort {
        if (properties.serviceToken.isBlank()) {
            log.warn(
                "리마인드 문구를 실 호출(http)로 켰는데 서비스 토큰이 비어 있습니다(SERVICE_AUTH_TOKEN) — " +
                    "{} 헤더 없이 나갑니다. 상대가 검증을 켜면 거부됩니다(TRIP-856).",
                SERVICE_TOKEN_HEADER,
            )
        }
        log.info("리마인드 문구 경계 = 실 AI(http) · baseUrl={}", properties.baseUrl)
        return HttpReminderCopyAdapter(client(properties), properties, clock)
    }

    /**
     * 경계 매퍼를 메시지 컨버터에 심는다 — 기본 컨버터면 snake_case 가 아니라 요청이 통째로 422 다.
     * `apply { }` 금지: `RestClient.Builder` 의 동명 멤버가 잡혀 `this` 가 빌더가 아니게 된다.
     */
    private fun client(properties: ReminderCopyProperties): RestClient =
        RestClient.builder()
            .baseUrl(properties.baseUrl)
            .requestFactory(
                SimpleClientHttpRequestFactory().apply {
                    setConnectTimeout(Duration.ofMillis(properties.connectTimeoutMs))
                    setReadTimeout(Duration.ofMillis(properties.readTimeoutMs))
                },
            )
            .messageConverters { it.add(0, JacksonJsonHttpMessageConverter(boundaryMapper())) }
            .let { b ->
                if (properties.serviceToken.isBlank()) b
                else b.defaultHeader(SERVICE_TOKEN_HEADER, properties.serviceToken)
            }
            .build()

    /**
     * 미배선 기본 — **빈 맵으로 "못 받았다"를 말한다**(예외 아님). 발화는 상수 문구로 간다.
     *
     * "Fake"라 부르지 않는다: 그럴듯한 문구를 지어내면 사용자가 **AI 가 쓴 줄 알고** 읽게 되고,
     * 나중에 실제로 켰을 때 품질 비교의 기준선이 거짓이 된다(회고 `UnwiredReflectionAgent` 선례).
     */
    @Bean
    @ConditionalOnMissingBean(ReminderCopyPort::class)
    fun unwiredReminderCopy(): ReminderCopyPort = UnwiredReminderCopy()

    companion object {
        /** 발신 서비스 자격증명 헤더(TRIP-856) — 일정·회고 경계와 같은 이름·같은 시크릿. */
        const val SERVICE_TOKEN_HEADER = "X-Service-Token"

        private val log = LoggerFactory.getLogger(ReminderCopyConfiguration::class.java)

        /** AI 경계 전용 매퍼 — snake_case. 앱 기본 매퍼와 무관하게 독립 생성(공개 API 영향 없음). */
        fun boundaryMapper(): JsonMapper = JsonMapper.builder()
            .addModule(KotlinModule.Builder().build())
            .propertyNamingStrategy(PropertyNamingStrategies.SNAKE_CASE)
            .build()
    }
}
