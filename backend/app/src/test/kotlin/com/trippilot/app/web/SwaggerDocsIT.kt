package com.trippilot.app.web

import com.trippilot.testsupport.AbstractPostgresIntegrationTest
import io.kotest.matchers.shouldBe
import io.kotest.matchers.string.shouldContain
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Value
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.http.client.JdkClientHttpRequestFactory
import org.springframework.web.client.RestClient

/**
 * Swagger UI 서빙 검증 — 스펙(/openapi.yaml)·UI(/swagger-ui.html)·webjar 자산이 무인증으로 200.
 * SecurityConfig 화이트리스트 + 정적 리소스 서빙 + openapi.yaml 복사(processResources)를 한 번에 확인.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class SwaggerDocsIT : AbstractPostgresIntegrationTest() {

    @Value("\${local.server.port}")
    private var port: Int = 0

    private fun get(path: String): Pair<Int, String> {
        val res = RestClient.builder()
            .requestFactory(JdkClientHttpRequestFactory())
            .baseUrl("http://localhost:$port")
            .build()
            .get().uri(path)
            .retrieve().onStatus({ it.is4xxClientError || it.is5xxServerError }, { _, _ -> })
            .toEntity(String::class.java)
        return res.statusCode.value() to (res.body ?: "")
    }

    @Test
    fun `openapi 스펙이 무인증으로 서빙된다`() {
        val (status, body) = get("/openapi.yaml")
        status shouldBe 200
        body shouldContain "openapi:" // docs/design 정본이 복사돼 서빙됨
    }

    @Test
    fun `swagger-ui 페이지가 무인증으로 서빙된다`() {
        get("/swagger-ui.html").first shouldBe 200
    }

    @Test
    fun `swagger-ui webjar 자산이 서빙된다`() {
        get("/webjars/swagger-ui/5.17.14/swagger-ui-bundle.js").first shouldBe 200
    }
}
