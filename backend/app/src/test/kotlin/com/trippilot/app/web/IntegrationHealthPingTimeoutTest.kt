package com.trippilot.app.web

import io.kotest.assertions.throwables.shouldThrow
import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.longs.shouldBeLessThan
import io.kotest.matchers.shouldBe
import io.kotest.matchers.types.shouldBeInstanceOf
import org.springframework.web.client.ResourceAccessException
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
}) {
    private companion object {
        private val SHORT: Duration = Duration.ofMillis(300)
        private const val UPPER_BOUND_MS = 5_000L
    }
}
