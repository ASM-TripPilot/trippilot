package com.trippilot.reflection.adapter.out.external

import com.trippilot.reflection.application.ShareCardCopyProperties
import com.trippilot.reflection.domain.port.ReflectionAgentInput
import com.trippilot.reflection.domain.port.ShareCardCopy
import com.trippilot.reflection.domain.port.ShareCardCopyPort
import org.slf4j.LoggerFactory
import org.springframework.boot.autoconfigure.condition.ConditionalOnMissingBean
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty
import org.springframework.boot.context.properties.EnableConfigurationProperties
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Configuration
import org.springframework.web.client.RestClient
import java.time.Clock
import java.util.UUID

/**
 * 실 공유 카드 문구 경계(`POST /ai/v1/reflection/share-card` · TRIP-1411).
 *
 * 회고 경계와 **같은 클라이언트 설정**을 쓴다 — 같은 상대·같은 요청 스키마이고, 마감([ReflectionAgentProperties.deadlineMs])과
 * 소켓 상한(`readTimeoutMs`)의 관계도 같다(상대 백스톱 = 마감 + 5초). 사용자가 [공유]를 누르고 기다리는 호출이라 마감을 둔다.
 *
 * 실패는 `null` 로 내리고 사유는 여기서 남긴다 — [HttpReflectionAgentAdapter] 와 같은 이유(위에서만 잡으면 어느 단계인지가 사라진다).
 */
class HttpShareCardCopyAdapter(
    private val client: RestClient,
    private val properties: ReflectionAgentProperties,
    private val clock: Clock,
) : ShareCardCopyPort {

    override val enabled = true

    override val maxWaitMs = properties.connectTimeoutMs + properties.readTimeoutMs

    override fun copy(input: ReflectionAgentInput): ShareCardCopy? {
        // 상대가 422 로 거절할 입력은 보내지 않는다(목적지 필수 · 방문 1건 이상) — 규칙은 한 곳([ReflectionAgentInput.callable]).
        if (!ReflectionAgentInput.callable(input.region, input.visits)) {
            log.debug("목적지나 실을 방문이 없어 공유 문구 AI 를 부르지 않습니다.")
            return null
        }
        return runCatching {
            client.post().uri(AiReflectionPaths.SHARE_CARD)
                .body(input.toWireRequest(UUID.randomUUID().toString(), clock.instant(), properties.deadlineMs))
                .retrieve().body(AiShareCardCopyResponse::class.java)
                ?.let { ShareCardCopy(it.caption, it.hashtags, it.isFallback) }
        }
            .onFailure { log.warn("공유 문구 AI 호출 실패 — 규칙 문구로 갑니다. base={}", properties.baseUrl, it) }
            .getOrNull()
    }

    private companion object {
        private val log = LoggerFactory.getLogger(HttpShareCardCopyAdapter::class.java)
    }
}

/**
 * 공유 문구 경계 배선 — 회고 경계와 **같은 스위치**(`trippilot.ai.reflection.mode`)다. 같은 상대의 같은 계열 기능이라 따로 켤 이유가 없고,
 * 스위치가 둘이면 "회고는 AI 인데 공유 문구만 규칙"이 설정 실수로 생긴다.
 *
 * 클라이언트는 [ReflectionAgentConfiguration.client] 를 그대로 쓴다(경계 매퍼·타임아웃·서비스 토큰 헤더가 한 곳에 있다).
 */
@Configuration
@EnableConfigurationProperties(ShareCardCopyProperties::class)
class ShareCardCopyConfiguration {

    @Bean
    @ConditionalOnProperty(name = ["trippilot.ai.reflection.mode"], havingValue = "http")
    fun httpShareCardCopy(
        reflection: ReflectionAgentConfiguration,
        properties: ReflectionAgentProperties,
        clock: Clock,
    ): ShareCardCopyPort = HttpShareCardCopyAdapter(reflection.client(properties), properties, clock)

    /** 켜지 않은 환경 — 규칙 문구로 간다. 요청마다 찍으면 로그가 무의미해지므로 debug 다(회고 미배선 구현과 같다). */
    @Bean
    @ConditionalOnMissingBean(ShareCardCopyPort::class)
    fun unwiredShareCardCopy(): ShareCardCopyPort = object : ShareCardCopyPort {
        override val enabled = false

        override val maxWaitMs = 0L // 부르지 않는다 — 동시 요청 거절까지 오지 않는다(꺼져 있으면 그 전에 규칙 조립)

        override fun copy(input: ReflectionAgentInput): ShareCardCopy? {
            log.debug("공유 문구 AI 경계 미배선 — 규칙 문구로 갑니다.")
            return null
        }
    }

    private companion object {
        private val log = LoggerFactory.getLogger(ShareCardCopyConfiguration::class.java)
    }
}
