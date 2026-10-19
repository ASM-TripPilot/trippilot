package com.trippilot.planbdetection.adapter.out.external

import com.trippilot.planbdetection.domain.OpportunityPort
import org.slf4j.LoggerFactory
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
 * 기회 카드 경계 설정(situation-awareness DEC-SA-6 · DEC-SA-8).
 *
 * [mode] = `off`(기본 — AI 0회·빈 목록) | `http`. 배포는 차트가 `AI_OPPORTUNITY_MODE=http` 를 **고정 env** 로 박는다(시크릿 아님).
 * 모르는 값은 기동 실패다 — 켰다고 믿는데 꺼진 채 도는 것보다 낫다(상황 감시 스윕 스위치와 같은 판단).
 *
 * 시한은 PERF-SA-08: 상대는 `deadline_ms` 의 70% 안에서 장소 조회를 끊고 부분 결과를 낸다. 읽기 상한은 그 위에
 * 상대 백스톱(마감 + 5s)까지 기다린다 — 그보다 짧으면 상대가 마감을 넘겨 정리해 보내는 응답을 우리가 먼저 끊는다.
 */
@ConfigurationProperties(prefix = "trippilot.ai.opportunity")
data class OpportunityProperties(
    val mode: String = OFF,
    val baseUrl: String = "http://localhost:8000",
    val connectTimeoutMs: Long = 1_000,
    /** `request_meta.deadline_ms` 로 상대에 실린다. 허브 카드라 짧게 잡는다 — 넘기면 상대가 부분 결과 + note 로 답한다. */
    val deadlineMs: Long = 3_000,
    val readTimeoutMs: Long = 8_000,
    /** 발신 서비스 자격증명(TRIP-856 선례). 비면 헤더를 안 싣고 호출은 그대로 나간다. */
    val serviceToken: String = "",
) {
    init {
        require(mode.lowercase() in setOf(OFF, HTTP)) {
            "trippilot.ai.opportunity.mode='$mode' 는 아는 값이 아닙니다(off|http) — 켰다고 믿는데 꺼진 채 돌게 됩니다."
        }
        require(readTimeoutMs >= deadlineMs + AI_BACKSTOP_MARGIN_MS) {
            "readTimeoutMs($readTimeoutMs)는 마감+백스톱(${deadlineMs + AI_BACKSTOP_MARGIN_MS})보다 작을 수 없습니다 — " +
                "상대가 마감을 넘겨 정리하는 응답을 우리가 먼저 끊게 됩니다."
        }
    }

    companion object {
        const val OFF = "off"
        const val HTTP = "http"

        /** 상대 `timeout_backstop` = deadline_ms + 5s(`TRIPPILOT_TIMEOUT_MARGIN_MS` 기본) — 리마인드·회고 경계와 같은 값. */
        const val AI_BACKSTOP_MARGIN_MS = 5_000L
    }
}

/**
 * 설정 값은 두 모드 모두에서 묶는다(모드 오타 검사가 꺼진 모드에서도 돌아야 한다). 조건은 실 어댑터 빈 하나에만 건다 —
 * 이 설정에는 그 밖의 빈이 없어 꺼진 모드의 부작용이 없다. 빈이 없으면 서비스가 꺼짐으로 읽는다(`OpportunityService`).
 */
@Configuration
@EnableConfigurationProperties(OpportunityProperties::class)
class OpportunityConfiguration {

    @Bean
    @ConditionalOnProperty(name = ["trippilot.ai.opportunity.mode"], havingValue = OpportunityProperties.HTTP)
    fun httpOpportunityPort(properties: OpportunityProperties, clock: Clock): OpportunityPort {
        if (properties.serviceToken.isBlank()) {
            log.warn(
                "기회 카드를 실 호출(http)로 켰는데 서비스 토큰이 비어 있습니다(SERVICE_AUTH_TOKEN) — " +
                    "{} 헤더 없이 나갑니다. 상대가 검증하면 거부되고 카드가 늘 비어 보입니다.",
                SERVICE_TOKEN_HEADER,
            )
        }
        log.info("기회 카드 경계 = 실 AI(http) · baseUrl={} · 시한 {}ms · 읽기 상한 {}ms", properties.baseUrl, properties.deadlineMs, properties.readTimeoutMs)
        return HttpOpportunityAdapter(client(properties), properties, clock)
    }

    /**
     * 전용 클라이언트 — 공유 `RestClient.Builder` 빈을 변형하지 않는다(다른 모듈 클라이언트 오염). 경계 매퍼는 이 클라이언트의
     * 컨버터로만 붙인다(빈으로 내놓으면 공개 API 응답이 snake_case 가 된다). `apply { }` 대신 `let` — 빌더의 동명 멤버가 잡힌다.
     */
    internal fun client(properties: OpportunityProperties): RestClient =
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

    companion object {
        /** 발신 서비스 자격증명 헤더 — 일정·회고·리마인드 경계와 같은 이름·같은 시크릿. */
        const val SERVICE_TOKEN_HEADER = "X-Service-Token"

        private val log = LoggerFactory.getLogger(OpportunityConfiguration::class.java)

        /** AI 경계 전용 매퍼 — snake_case + Kotlin(없으면 data class 가 예외 없이 빈 값이 된다). 앱 기본 매퍼와 무관하다. */
        fun boundaryMapper(): JsonMapper = JsonMapper.builder()
            .addModule(KotlinModule.Builder().build())
            .propertyNamingStrategy(PropertyNamingStrategies.SNAKE_CASE)
            .build()
    }
}
