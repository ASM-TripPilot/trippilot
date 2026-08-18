package com.trippilot.app.web

import org.springframework.beans.factory.annotation.Value
import org.springframework.http.client.SimpleClientHttpRequestFactory
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.RestController
import org.springframework.web.client.RestClient
import java.time.Duration

/**
 * 컨테이너 통합 테스트용 — BE 가 compose 네트워크로 AI 컨테이너(`ai:8000`)에 닿는지 확인.
 * AI_URL 미설정(로컬 bootRun 등)이면 우아하게 degrade. 실제 AI 연동은 후속.
 *
 * **타임아웃이 붙어 있다.** 헬스핑에 상한이 없으면 AI 가 죽지 않고 **느려지기만 해도** 이 요청 스레드가
 * 무한히 물린다 — 상태를 보러 부르는 엔드포인트가 도리어 매달리는 셈이다. 상한을 짧게 잡는 이유도 같다:
 * 2초 안에 응답하지 못하는 상대는 이 판정의 목적상 이미 정상이 아니다.
 */
@RestController
class IntegrationController(
    @Value("\${ai.url:}") private val aiUrl: String,
) {
    private val client = healthClient(CONNECT_TIMEOUT, READ_TIMEOUT)

    @GetMapping("/api/integration")
    fun integration(): Map<String, Any?> {
        val ai: Any? = if (aiUrl.isBlank()) {
            "not-configured"
        } else {
            runCatching {
                client.get().uri("$aiUrl/health").retrieve().body(String::class.java)
            }.getOrElse { "unreachable: ${it.message}" }
        }
        return mapOf("backend" to "UP", "ai" to ai)
    }

    companion object {
        /**
         * 생성 경로 — 운영은 아래 상수로, 테스트는 짧은 값으로 **같은 코드**를 태운다.
         * 타임아웃은 실제 소켓에서만 드러나 `MockRestServiceServer` 로는 설정 유무를 구분하지 못한다.
         */
        internal fun healthClient(connectTimeout: Duration, readTimeout: Duration): RestClient =
            RestClient.builder()
                .requestFactory(
                    SimpleClientHttpRequestFactory().apply {
                        setConnectTimeout(connectTimeout)
                        setReadTimeout(readTimeout)
                    },
                )
                .build()

        /** 헬스핑은 붙는지만 본다 — 붙지 않는 상대를 오래 기다릴 이유가 없다. */
        internal val CONNECT_TIMEOUT: Duration = Duration.ofSeconds(2)

        /** `/health` 는 즉답이 정상이다. 2초를 넘기면 그 자체가 "정상 아님"이라는 답이다. */
        internal val READ_TIMEOUT: Duration = Duration.ofSeconds(2)
    }
}
