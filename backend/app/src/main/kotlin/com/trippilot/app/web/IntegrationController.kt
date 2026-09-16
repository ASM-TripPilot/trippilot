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
    /**
     * 발신 자격증명 — **다른 AI 호출과 같은 시크릿**(`trippilot.service-auth.token`).
     *
     * 헬스는 관례상 무인증이라 종전에는 안 붙였는데, 상대가 인바운드 검증을 **전 경로에 일괄로** 걸면
     * 이 핑이 제일 먼저 깨진다. 그때 증상은 `/integration` 이 `unreachable` 로 보이는 것뿐이라
     * "AI 가 죽었다"로 읽히고, 진짜 원인(인증 추가)은 어디에도 안 드러난다.
     */
    @Value("\${trippilot.service-auth.token:}") private val serviceToken: String,
) {
    private val client = healthClient(CONNECT_TIMEOUT, READ_TIMEOUT, serviceToken)

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
        internal fun healthClient(
            connectTimeout: Duration,
            readTimeout: Duration,
            serviceToken: String = "",
        ): RestClient =
            RestClient.builder()
                .requestFactory(
                    SimpleClientHttpRequestFactory().apply {
                        setConnectTimeout(connectTimeout)
                        setReadTimeout(readTimeout)
                    },
                )
                // 비어 있으면 **붙이지 않는다** — 빈 값으로 실으면 상대가 "제시됐는데 틀림"으로 읽어
                // 거부 사유가 '잘못된 토큰'이 되고 진짜 원인(미설정)이 로그에서 사라진다.
                // `apply { }` 를 쓰지 않는다 — `RestClient.Builder` 에 동명의 멤버가 있어 그쪽이 잡힌다.
                .let { builder ->
                    if (serviceToken.isBlank()) builder
                    else builder.defaultHeader(SERVICE_TOKEN_HEADER, serviceToken)
                }
                .build()

        /**
         * 상대(AI)가 받는 계약이라 수신용 상수([com.trippilot.security.ServiceTokenAuthFilter.HEADER])와
         * 묶지 않는다 — 같은 문자열이지만 검증자가 다르다. 다른 발신 어댑터들도 같은 이유로 각자 둔다.
         */
        internal const val SERVICE_TOKEN_HEADER = "X-Service-Token"

        /** 헬스핑은 붙는지만 본다 — 붙지 않는 상대를 오래 기다릴 이유가 없다. */
        internal val CONNECT_TIMEOUT: Duration = Duration.ofSeconds(2)

        /** `/health` 는 즉답이 정상이다. 2초를 넘기면 그 자체가 "정상 아님"이라는 답이다. */
        internal val READ_TIMEOUT: Duration = Duration.ofSeconds(2)
    }
}
