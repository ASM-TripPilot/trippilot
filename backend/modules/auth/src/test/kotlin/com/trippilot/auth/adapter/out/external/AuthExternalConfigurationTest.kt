package com.trippilot.auth.adapter.out.external

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
 * OAuth 클라이언트용 공유 빌더의 타임아웃 — **실 소켓으로만 드러난다**(`MockRestServiceServer` 는 소켓을 타지 않는다).
 *
 * IdP 가 죽으면 연결 거부로 즉시 실패하지만, **느려지기만 하면** 타임아웃이 없는 한 로그인 요청 스레드가
 * 무한히 물린다. 로그인은 사용자가 기다리는 동기 경로라 이 상태가 그대로 체감된다.
 */
class AuthExternalConfigurationTest : StringSpec({

    "응답하지 않는 IdP 에 로그인 스레드가 물리지 않는다" {
        val server = ServerSocket(0)
        val held = mutableListOf<Socket>()
        // 연결은 받아주고 한 바이트도 쓰지 않는다.
        val accepter = thread(isDaemon = true) { runCatching { while (true) held += server.accept() } }
        try {
            val client = AuthExternalConfiguration().restClientBuilder(SHORT, SHORT).build()

            lateinit var thrown: ResourceAccessException
            val elapsed = measureTimeMillis {
                thrown = shouldThrow<ResourceAccessException> {
                    client.get()
                        .uri(URI.create("http://127.0.0.1:${server.localPort}/oauth2/token"))
                        .retrieve()
                        .body(String::class.java)
                }
            }

            thrown.cause.shouldBeInstanceOf<SocketTimeoutException>()
            elapsed shouldBeLessThan UPPER_BOUND_MS
        } finally {
            held.forEach { runCatching { it.close() } }
            server.close()
            accepter.interrupt()
        }
    }

    "운영 상수는 3초·5초다" {
        AuthExternalConfiguration.CONNECT_TIMEOUT shouldBe Duration.ofSeconds(3)
        AuthExternalConfiguration.READ_TIMEOUT shouldBe Duration.ofSeconds(5)
    }
}) {
    private companion object {
        private val SHORT: Duration = Duration.ofMillis(300)
        private const val UPPER_BOUND_MS = 5_000L
    }
}
