package com.trippilot.placedata.adapter.out.external

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
 * 타임아웃 검증 — **실 소켓으로만 드러난다**. `MockRestServiceServer` 는 요청을 가로채 소켓을 타지 않으므로
 * 타임아웃 설정 유무를 원리적으로 구분하지 못한다.
 *
 * 재현하는 상황은 "벤더가 죽음"이 아니라 **"벤더가 붙여는 주고 응답하지 않음"** 이다. 죽은 상대는 연결 거부로
 * 즉시 실패하지만, 느린 상대는 타임아웃이 없으면 호출 스레드를 무한히 붙잡는다 — 이쪽이 위험하다.
 */
class KakaoLocalClientConfigurationTest : StringSpec({

    "응답하지 않는 벤더에 스레드가 물리지 않는다 — read 타임아웃이 상한을 만든다" {
        val server = ServerSocket(0)
        val held = mutableListOf<Socket>()
        // 연결은 받아주고 한 바이트도 쓰지 않는다.
        val accepter = thread(isDaemon = true) { runCatching { while (true) held += server.accept() } }
        try {
            val client = KakaoLocalClientConfiguration().build(SHORT, SHORT)

            lateinit var thrown: ResourceAccessException
            val elapsed = measureTimeMillis {
                thrown = shouldThrow<ResourceAccessException> {
                    client.get()
                        .uri(URI.create("http://127.0.0.1:${server.localPort}/v2/local/search/address.json"))
                        .retrieve()
                        .body(String::class.java)
                }
            }

            // 원인이 타임아웃이어야 한다 — 연결 거부·프로토콜 오류로 빨리 끝난 것과 구분한다.
            thrown.cause.shouldBeInstanceOf<SocketTimeoutException>()
            elapsed shouldBeLessThan UPPER_BOUND_MS
        } finally {
            held.forEach { runCatching { it.close() } }
            server.close()
            accepter.interrupt()
        }
    }

    /**
     * 값이 조용히 늘어나면 "타임아웃이 있다"는 사실만 남고 실효가 사라진다.
     * 바꿀 이유가 생기면 이 테스트를 같이 고치면서 근거를 남긴다.
     */
    "운영 상수는 3초·5초다" {
        KakaoLocalClientConfiguration.CONNECT_TIMEOUT shouldBe Duration.ofSeconds(3)
        KakaoLocalClientConfiguration.READ_TIMEOUT shouldBe Duration.ofSeconds(5)
    }
}) {
    private companion object {
        /** 테스트는 짧은 값으로 같은 생성 경로를 태운다 — 운영 5초를 그대로 기다리지 않는다. */
        private val SHORT: Duration = Duration.ofMillis(300)

        /** 300ms 상한이 실제로 걸렸는지만 보면 된다. 느린 CI 를 감안해 넉넉히 잡는다. */
        private const val UPPER_BOUND_MS = 5_000L
    }
}
