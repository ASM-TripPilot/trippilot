package com.trippilot.app.web

import com.trippilot.security.AccessTokenIssuer
import com.trippilot.testsupport.AbstractPostgresIntegrationTest
import io.kotest.matchers.shouldBe
import io.kotest.matchers.shouldNotBe
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.beans.factory.annotation.Value
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.web.client.RestClient
import java.util.UUID

/**
 * TRIP-153 1단계 — 무상태 보안 필터체인(R6). 공개 화이트리스트 vs Bearer JWT 게이트.
 * 유효 토큰은 AccessTokenIssuer 로 직접 발급(실제 IdP 불필요).
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class SecurityFilterChainIT : AbstractPostgresIntegrationTest() {

    @Value("\${local.server.port}")
    private var port: Int = 0

    @Autowired
    private lateinit var accessTokenIssuer: AccessTokenIssuer

    private fun getStatus(path: String, bearer: String? = null): Int {
        val spec = RestClient.create("http://localhost:$port").get().uri(path)
        bearer?.let { spec.header("Authorization", "Bearer $it") }
        return spec.retrieve()
            .onStatus({ it.is4xxClientError || it.is5xxServerError }, { _, _ -> }) // 상태만 확인
            .toBodilessEntity()
            .statusCode.value()
    }

    @Test
    fun `헬스체크는 토큰 없이 200 (compose 헬스체크 보존)`() {
        getStatus("/actuator/health") shouldBe 200
    }

    @Test
    fun `보호 엔드포인트는 토큰이 없으면 401`() {
        getStatus("/api/v1/protected-probe") shouldBe 401
    }

    @Test
    fun `유효한 JWT 는 인증 필터를 통과한다 (401 아님)`() {
        val token = accessTokenIssuer.issue(UUID.randomUUID().toString()).value

        // 유효 토큰이면 리소스 서버 필터를 통과 — 이후 상태(미매핑 경로)가 무엇이든 401 은 아니어야 한다.
        getStatus("/api/v1/protected-probe", token) shouldNotBe 401
    }
}
