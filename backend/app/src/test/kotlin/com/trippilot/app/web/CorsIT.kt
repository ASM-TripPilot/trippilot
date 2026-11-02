package com.trippilot.app.web

import com.trippilot.app.config.SecurityConfig
import com.trippilot.testsupport.AbstractPostgresIntegrationTest
import io.kotest.assertions.throwables.shouldThrow
import io.kotest.matchers.nulls.shouldBeNull
import io.kotest.matchers.nulls.shouldNotBeNull
import io.kotest.matchers.shouldBe
import io.kotest.matchers.string.shouldContain
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Value
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.http.HttpHeaders
import org.springframework.http.HttpMethod
import org.springframework.http.ResponseEntity
import org.springframework.http.client.JdkClientHttpRequestFactory
import org.springframework.mock.web.MockHttpServletRequest
import org.springframework.web.client.RestClient

/**
 * 웹 클라이언트 CORS(TRIP-1655) — 실제 필터 체인을 소켓으로 태운다.
 *
 * 정상: 허용 출처의 프리플라이트는 200 + 그 출처의 ACAO, 인증이 필요한 경로라도 401 로 막히지 않는다.
 * 금지: 목록 밖 출처에는 ACAO 가 없다(`*` 도 아니다). Origin 없는 모바일 요청은 CORS 헤더 없이 지금과 같다.
 */
@SpringBootTest(
    webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
    properties = ["trippilot.web.cors-allowed-origins=https://app.example.test, http://localhost:8081/"],
)
class CorsIT : AbstractPostgresIntegrationTest() {

    @Value("\${local.server.port}")
    private var port: Int = 0

    private fun call(method: HttpMethod, path: String, headers: Map<String, String>): ResponseEntity<String> =
        RestClient.builder()
            .requestFactory(JdkClientHttpRequestFactory())
            .baseUrl("http://localhost:$port")
            .build()
            .method(method).uri(path)
            .headers { h -> headers.forEach { (k, v) -> h.set(k, v) } }
            .retrieve().onStatus({ it.is4xxClientError || it.is5xxServerError }, { _, _ -> })
            .toEntity(String::class.java)

    private fun preflight(origin: String, path: String) = call(
        HttpMethod.OPTIONS,
        path,
        mapOf(
            HttpHeaders.ORIGIN to origin,
            HttpHeaders.ACCESS_CONTROL_REQUEST_METHOD to "GET",
            HttpHeaders.ACCESS_CONTROL_REQUEST_HEADERS to "authorization,content-type",
        ),
    )

    @Test
    fun `허용 출처의 프리플라이트는 200 과 그 출처의 ACAO 를 받는다`() {
        val res = preflight("https://app.example.test", "/api/v1/bootstrap")
        res.statusCode.value() shouldBe 200
        res.headers.getFirst(HttpHeaders.ACCESS_CONTROL_ALLOW_ORIGIN) shouldBe "https://app.example.test"
        res.headers.getFirst(HttpHeaders.ACCESS_CONTROL_ALLOW_HEADERS).shouldNotBeNull().lowercase() shouldContain "authorization"
        res.headers.getFirst(HttpHeaders.ACCESS_CONTROL_ALLOW_CREDENTIALS).shouldBeNull()
    }

    @Test
    fun `인증이 필요한 경로의 프리플라이트도 인증 필터에 막히지 않는다`() {
        val res = preflight("http://localhost:8081", "/api/v1/trips")
        res.statusCode.value() shouldBe 200
        res.headers.getFirst(HttpHeaders.ACCESS_CONTROL_ALLOW_ORIGIN) shouldBe "http://localhost:8081"
    }

    @Test
    fun `웹이 bootstrap 응답을 읽을 수 있다 — 실요청에도 ACAO 와 Retry-After 노출이 붙는다`() {
        val res = call(HttpMethod.GET, "/api/v1/bootstrap", mapOf(HttpHeaders.ORIGIN to "https://app.example.test"))
        res.statusCode.value() shouldBe 200
        res.headers.getFirst(HttpHeaders.ACCESS_CONTROL_ALLOW_ORIGIN) shouldBe "https://app.example.test"
        res.headers.getFirst(HttpHeaders.ACCESS_CONTROL_EXPOSE_HEADERS).shouldNotBeNull() shouldContain "Retry-After"
    }

    @Test
    fun `목록 밖 출처에는 ACAO 가 없다 — 브라우저가 응답을 읽지 못한다`() {
        // 프리플라이트 상태 코드는 보지 않는다: CorsFilter 는 설정이 없어도 프리플라이트를 거기서 끝낸다(200, 헤더 없음).
        // 막는 것은 ACAO 부재다 — 브라우저는 그것을 보고 본 요청을 보내지 않는다.
        val pre = preflight("https://evil.example.test", "/api/v1/trips")
        pre.headers.getFirst(HttpHeaders.ACCESS_CONTROL_ALLOW_ORIGIN).shouldBeNull()
        pre.headers.getFirst(HttpHeaders.ACCESS_CONTROL_ALLOW_METHODS).shouldBeNull()

        val get = call(HttpMethod.GET, "/api/v1/bootstrap", mapOf(HttpHeaders.ORIGIN to "https://evil.example.test"))
        get.headers.getFirst(HttpHeaders.ACCESS_CONTROL_ALLOW_ORIGIN).shouldBeNull()
    }

    @Test
    fun `Origin 없는 모바일 요청은 CORS 헤더 없이 지금과 같다`() {
        val res = call(HttpMethod.GET, "/api/v1/bootstrap", emptyMap())
        res.statusCode.value() shouldBe 200
        res.headers.getFirst(HttpHeaders.ACCESS_CONTROL_ALLOW_ORIGIN).shouldBeNull()
        res.headers.getFirst(HttpHeaders.ACCESS_CONTROL_EXPOSE_HEADERS).shouldBeNull()
    }

    @Test
    fun `설정 파싱 — 비면 CORS 미적용, 와일드카드는 기동 거부, 끝 슬래시·공백은 정규화`() {
        SecurityConfig.corsSource("").shouldBeNull()
        SecurityConfig.corsSource(" , ").shouldBeNull()
        shouldThrow<IllegalStateException> { SecurityConfig.corsSource("*") }
        shouldThrow<IllegalStateException> { SecurityConfig.corsSource("https://a.test,https://*.b.test") }

        val source = SecurityConfig.corsSource(" https://a.test/ ").shouldNotBeNull()
        source.getCorsConfiguration(MockHttpServletRequest().apply { addHeader("Origin", "https://a.test") })
            .shouldNotBeNull().allowedOrigins shouldBe listOf("https://a.test")
        source.getCorsConfiguration(MockHttpServletRequest().apply { addHeader("Origin", "https://a.test.evil") }).shouldBeNull()
        source.getCorsConfiguration(MockHttpServletRequest()).shouldBeNull()
    }
}
