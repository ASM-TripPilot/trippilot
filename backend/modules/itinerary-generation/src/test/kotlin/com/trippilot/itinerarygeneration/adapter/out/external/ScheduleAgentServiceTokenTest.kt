package com.trippilot.itinerarygeneration.adapter.out.external

import com.sun.net.httpserver.HttpServer
import com.trippilot.itinerarygeneration.application.ScheduleDeadlineProperties
import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.collections.shouldHaveSize
import io.kotest.matchers.shouldBe
import org.springframework.web.client.RestClient
import java.net.InetSocketAddress

/**
 * 발신 서비스 자격증명(TRIP-856) — **실 소켓으로만 확인된다.**
 *
 * `MockRestServiceServer` 는 `RestClient.Builder` 에 붙어야 하는데, 이 설정은 빌더를 내부에서 만들어
 * 완성된 `RestClient` 만 돌려준다. 즉 우리가 검증하려는 대상(설정이 실제로 붙인 기본 헤더)을
 * 원리적으로 못 본다. 그래서 JDK 내장 서버를 띄워 **상대가 실제로 받은 헤더**를 센다.
 *
 * 켜는 쪽·끄는 쪽을 둘 다 센다. 붙는 것만 확인하면 "토큰이 없을 때 빈 헤더를 싣는" 경로가 통과한다 —
 * 그러면 상대의 거부 사유가 '미설정'이 아니라 '틀린 토큰'이 되어 원인 추적이 한 단계 멀어진다.
 */
class ScheduleAgentServiceTokenTest : StringSpec({

    "토큰을 설정하면 두 클라이언트가 모두 X-Service-Token 을 싣는다" {
        withCapturingServer { baseUrl, received ->
            val properties = properties(baseUrl, token = "s3cr3t")
            val configuration = ScheduleAgentConfiguration()

            // 생성용과 편집용(짧게 끊는) 클라이언트는 따로 만들어진다 — 한쪽만 붙는 일이 실제로 가능하다.
            configuration.scheduleAgentRestClient(properties, deadlines()).ping()
            configuration.scheduleAgentBoundedRestClient(properties, deadlines()).ping()

            received shouldHaveSize 2
            received.forEach { it shouldBe "s3cr3t" }
        }
    }

    "토큰이 비면 헤더를 아예 싣지 않고, 호출은 그대로 나간다(fail-open)" {
        withCapturingServer { baseUrl, received ->
            val properties = properties(baseUrl, token = "")

            ScheduleAgentConfiguration()
                .scheduleAgentRestClient(properties, deadlines())
                .ping()

            // 요청이 도착했다 = 토큰이 없다고 호출을 막지 않았다. 이것이 뒤집히면 토큰을 안 넣은
            // 로컬·CI 에서 일정 생성이 통째로 죽는다.
            received shouldHaveSize 1
            received.single() shouldBe null
        }
    }

    /**
     * **헤더 이름을 글자 그대로 못 박는다.** 위 두 테스트는 보내는 쪽과 받는 쪽이 같은 상수를 쓰므로
     * 상수가 틀린 값으로 바뀌어도 **나란히 따라가며 통과한다** — 상대는 아무것도 못 받는데 초록이다.
     * 이름은 우리 취향이 아니라 상대와의 계약이라(역방향 필터·AI 클라이언트가 같은 문자열을 쓴다),
     * 리터럴로 고정해 드리프트를 빌드에서 잡는다.
     */
    "헤더 이름은 계약이다 — X-Service-Token" {
        ScheduleAgentConfiguration.SERVICE_TOKEN_HEADER shouldBe "X-Service-Token"
    }
})

private const val HEADER = ScheduleAgentConfiguration.SERVICE_TOKEN_HEADER

private fun properties(baseUrl: String, token: String) = ScheduleAgentProperties(
    mode = "http",
    baseUrl = baseUrl,
    serviceToken = token,
)

/**
 * **시한을 일부러 짧게 준다.** 운영 기본값(시한 미적용)이면 read 상한이 612초라, 테스트 서버가
 * 응답하지 않는 순간 실패가 아니라 **10분 정지**가 된다 — CI 에서 가장 나쁜 실패 모양이다.
 * 여기서 재는 것은 헤더뿐이라 시한 값 자체는 무관하다.
 */
private fun deadlines() = ScheduleDeadlineProperties(enforced = true, totalMs = 5_000, editWaitMs = 5_000)

/** 본문을 파싱하지 않는다 — 여기서 재는 것은 요청 헤더뿐이다. */
private fun RestClient.ping() {
    get().uri("/ping").retrieve().toBodilessEntity()
}

/**
 * 받은 요청의 [HEADER] 값을 순서대로 모은다. 헤더가 없으면 `null` 이 들어가므로
 * "안 실림"과 "빈 값으로 실림"이 구분된다.
 */
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
