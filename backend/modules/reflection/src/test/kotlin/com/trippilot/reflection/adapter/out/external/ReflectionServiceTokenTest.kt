package com.trippilot.reflection.adapter.out.external

import com.sun.net.httpserver.HttpServer
import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.collections.shouldHaveSize
import io.kotest.matchers.shouldBe
import java.net.InetSocketAddress

/**
 * 회고 발신 자격증명(TRIP-856). 근거·방법은 일정 쪽 `ScheduleAgentServiceTokenTest` 와 같다 —
 * 두 경계가 **각자 자기 RestClient 를 만들기 때문에** 한쪽만 붙는 상태가 실제로 가능해 따로 센다.
 */
class ReflectionServiceTokenTest : StringSpec({

    "토큰을 설정하면 발신 요청에 X-Service-Token 이 실린다" {
        withCapturingServer { baseUrl, received ->
            ReflectionAgentConfiguration()
                .client(properties(baseUrl, token = "s3cr3t"))
                .get().uri("/ping").retrieve().toBodilessEntity()

            received shouldHaveSize 1
            received.single() shouldBe "s3cr3t"
        }
    }

    "토큰이 비면 헤더를 아예 싣지 않고, 호출은 그대로 나간다(fail-open)" {
        withCapturingServer { baseUrl, received ->
            ReflectionAgentConfiguration()
                .client(properties(baseUrl, token = ""))
                .get().uri("/ping").retrieve().toBodilessEntity()

            received shouldHaveSize 1
            received.single() shouldBe null
        }
    }
})

private const val HEADER = ReflectionAgentConfiguration.SERVICE_TOKEN_HEADER

private fun properties(baseUrl: String, token: String) = ReflectionAgentProperties(
    mode = "http",
    baseUrl = baseUrl,
    serviceToken = token,
)

private fun withCapturingServer(block: (baseUrl: String, received: List<String?>) -> Unit) {
    val received = mutableListOf<String?>()
    val server = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0)
    server.createContext("/ping") { exchange ->
        received += exchange.requestHeaders.getFirst(HEADER)
        exchange.sendResponseHeaders(200, -1)
        exchange.close()
    }
    server.start()
    try {
        block("http://127.0.0.1:${server.address.port}", received)
    } finally {
        server.stop(0)
    }
}
