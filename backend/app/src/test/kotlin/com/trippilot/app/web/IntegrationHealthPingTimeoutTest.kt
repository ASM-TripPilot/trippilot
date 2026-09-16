package com.trippilot.app.web

import com.sun.net.httpserver.HttpServer
import io.kotest.assertions.throwables.shouldThrow
import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.longs.shouldBeLessThan
import io.kotest.matchers.shouldBe
import io.kotest.matchers.types.shouldBeInstanceOf
import org.springframework.web.client.ResourceAccessException
import java.net.InetSocketAddress
import java.net.ServerSocket
import java.net.Socket
import java.net.SocketTimeoutException
import java.net.URI
import java.time.Duration
import kotlin.concurrent.thread
import kotlin.system.measureTimeMillis

/**
 * AI 헬스핑 타임아웃 — **실 소켓으로만 드러난다**(`MockRestServiceServer` 는 소켓을 타지 않는다).
 *
 * 재현하는 상황은 "AI 가 죽음"이 아니라 **"붙여는 주고 응답하지 않음"** 이다. 죽은 상대는 연결 거부로
 * 즉시 실패하지만, 느린 상대는 타임아웃이 없으면 요청 스레드를 무한히 붙잡는다 —
 * 상태를 보려고 부른 엔드포인트가 도리어 매달린다.
 */
class IntegrationHealthPingTimeoutTest : StringSpec({

    "응답하지 않는 AI 에 헬스핑이 물리지 않는다" {
        val server = ServerSocket(0)
        val held = mutableListOf<Socket>()
        // 연결은 받아주고 한 바이트도 쓰지 않는다.
        val accepter = thread(isDaemon = true) { runCatching { while (true) held += server.accept() } }
        try {
            val client = IntegrationController.healthClient(SHORT, SHORT)

            lateinit var thrown: ResourceAccessException
            val elapsed = measureTimeMillis {
                thrown = shouldThrow<ResourceAccessException> {
                    client.get()
                        .uri(URI.create("http://127.0.0.1:${server.localPort}/health"))
                        .retrieve()
                        .body(String::class.java)
                }
            }

            // 원인이 타임아웃이어야 한다 — 연결 거부로 빨리 끝난 것과 구분한다.
            thrown.cause.shouldBeInstanceOf<SocketTimeoutException>()
            elapsed shouldBeLessThan UPPER_BOUND_MS
        } finally {
            held.forEach { runCatching { it.close() } }
            server.close()
            accepter.interrupt()
        }
    }

    /** 값이 조용히 늘어나면 "타임아웃이 있다"는 사실만 남고 실효가 사라진다. */
    "운영 상수는 2초·2초다" {
        IntegrationController.CONNECT_TIMEOUT shouldBe Duration.ofSeconds(2)
        IntegrationController.READ_TIMEOUT shouldBe Duration.ofSeconds(2)
    }

    /**
     * **헬스핑에도 서비스 토큰이 실린다**(TRIP-856 후속).
     *
     * 헬스는 관례상 무인증이라 종전에는 안 붙였다. 그런데 상대가 인바운드 검증을 **전 경로에 일괄로**
     * 걸면 이 핑이 제일 먼저 깨지고, 증상은 `/integration` 이 `unreachable` 로 보이는 것뿐이다 —
     * "AI 가 죽었다"로 읽히고 진짜 원인(인증이 생겼다)은 어디에도 안 드러난다.
     *
     * **상대가 실제로 받은 헤더를 봐야 한다** — 클라이언트 설정만 확인하면 기본 헤더가 요청에
     * 실리는지까지는 모른다.
     */
    "토큰이 설정돼 있으면 헬스핑 요청에 X-Service-Token 이 실린다" {
        withCapturingServer { port, headers ->
            runCatching {
                IntegrationController.healthClient(SHORT, SHORT, TOKEN)
                    .get().uri(URI.create("http://127.0.0.1:$port/health")).retrieve().body(String::class.java)
            }

            headers.single()["x-service-token"] shouldBe TOKEN
        }
    }

    /**
     * **비면 붙이지 않는다 — 빈 값으로 싣지 않는다.** 빈 헤더를 실으면 상대가 "제시됐는데 틀림"으로
     * 읽어 거부 사유가 '잘못된 토큰'이 되고, 진짜 원인(미설정)이 상대 로그에서 사라진다.
     */
    "토큰이 비어 있으면 헤더 자체를 붙이지 않는다" {
        withCapturingServer { port, headers ->
            runCatching {
                IntegrationController.healthClient(SHORT, SHORT, "")
                    .get().uri(URI.create("http://127.0.0.1:$port/health")).retrieve().body(String::class.java)
            }

            headers.single().containsKey("x-service-token") shouldBe false
        }
    }
}) {
    private companion object {
        private val SHORT: Duration = Duration.ofMillis(300)
        private const val UPPER_BOUND_MS = 5_000L

        /**
         * **ASCII 다.** HTTP 헤더는 latin-1 로 왕복해서 비ASCII 값은 그대로 깨진다
         * (실측: 한글 토큰이 `ì‹¤í† í°` 으로 되돌아왔다). 실제 토큰은 base64·hex 라 문제가 없지만,
         * 시험값으로 한글을 쓰면 **깨진 것이 구현 결함처럼 보인다.**
         */
        private const val TOKEN = "svc-token-abc123"
    }
}

/**
 * 받은 요청 헤더를 모으는 최소 서버. 헤더 이름은 **소문자로 정규화**해 담는다 —
 * HTTP 헤더는 대소문자를 안 가리므로 원문 그대로 비교하면 클라이언트 구현이 바뀔 때 헛되이 깨진다.
 */
private fun withCapturingServer(block: (port: Int, headers: List<Map<String, String>>) -> Unit) {
    val seen = mutableListOf<Map<String, String>>()
    val server = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0)
    server.createContext("/health") { ex ->
        seen += ex.requestHeaders.entries.associate { it.key.lowercase() to it.value.first() }
        val bytes = "ok".toByteArray()
        ex.sendResponseHeaders(200, bytes.size.toLong())
        ex.responseBody.use { it.write(bytes) }
    }
    server.start()
    try {
        block(server.address.port, seen)
    } finally {
        server.stop(0)
    }
}
