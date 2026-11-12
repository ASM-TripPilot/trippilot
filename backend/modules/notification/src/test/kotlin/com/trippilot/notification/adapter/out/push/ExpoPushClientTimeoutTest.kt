package com.trippilot.notification.adapter.out.push

import com.trippilot.notification.domain.PushMessage
import com.trippilot.notification.domain.PushUrgency
import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.longs.shouldBeBetween
import io.kotest.matchers.shouldBe
import io.kotest.matchers.types.shouldBeInstanceOf
import org.springframework.web.client.RestClientException
import java.net.InetAddress
import java.net.ServerSocket
import java.net.Socket
import java.net.SocketTimeoutException
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import kotlin.concurrent.thread

/**
 * Expo 호출의 **시한**. 시한이 없으면 응답 없는 exp.host 하나가 발화 폴러·릴레이 스레드와 DB 트랜잭션을 영영
 * 붙들어, 오류도 로그도 없이 모든 리마인드·사건 알림이 멈춘다(재시작 뒤엔 밀린 예약이 유예를 넘겨 영구 취소).
 *
 * 이 빈은 CI 에서 뜨지 않는다(게이트: 외부 호출 0) — 그래서 **운영이 쓰는 빈 메서드를 직접 불러** 시한이 실제로
 * 걸리는지 로컬 소켓으로 잰다. MockRestServiceServer 는 요청 팩토리를 갈아 끼우므로 시한을 못 잰다.
 */
class ExpoPushClientTimeoutTest : StringSpec({

    val message = PushMessage("제목", "본문", urgency = PushUrgency.ACTIVE)

    /** 연결은 받고 한 바이트도 안 쓰는 서버 — 응답 없이 멈춘 exp.host 를 흉내 낸다. */
    fun <T> withSilentServer(block: (baseUrl: String) -> T): T {
        ServerSocket(0, 50, InetAddress.getLoopbackAddress()).use { server ->
            val held = CopyOnWriteArrayList<Socket>()
            val acceptor = thread(isDaemon = true) { runCatching { while (true) held += server.accept() } }
            try {
                return block("http://127.0.0.1:${server.localPort}")
            } finally {
                held.forEach { runCatching { it.close() } }
                acceptor.interrupt()
            }
        }
    }

    "응답이 없는 서버에서는 읽기 시한 안에 실패한다 — 발송 호출이 영영 안 돌아오지 않는다" {
        withSilentServer { baseUrl ->
            val client = ExpoPushClientConfiguration().expoPushRestClient(baseUrl, connectTimeoutMs = 500, readTimeoutMs = 300)
            val pool = Executors.newSingleThreadExecutor { r -> Thread(r).apply { isDaemon = true } }
            try {
                val outcome = pool.submit<Throwable?> {
                    runCatching { ExpoPushAdapter("", client).send(listOf("t1"), message) }.exceptionOrNull()
                }
                // 시한이 없으면 여기서 TimeoutException — 호출이 끝내 안 돌아온다.
                val failure = outcome.get(5, TimeUnit.SECONDS)
                failure.shouldBeInstanceOf<RestClientException>()
                // 다른 사유(본문 해석 오류 등)가 아니라 **시한 초과**여야 한다.
                generateSequence<Throwable>(failure) { it.cause }.any { it is SocketTimeoutException } shouldBe true
            } finally {
                pool.shutdownNow()
            }
        }
    }

    "기본 시한은 유한하다 — 폴러(60초)·릴레이(락 5분)를 오래 못 잡는 길이" {
        ExpoPushClientConfiguration.DEFAULT_CONNECT_TIMEOUT_MS.shouldBeBetween(1L, 5_000L)
        ExpoPushClientConfiguration.DEFAULT_READ_TIMEOUT_MS.shouldBeBetween(1L, 15_000L)
    }
})
