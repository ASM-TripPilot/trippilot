package com.trippilot.planbdetection.adapter.out.external

import com.sun.net.httpserver.HttpServer
import com.trippilot.planbdetection.domain.Opportunity
import com.trippilot.planbdetection.domain.OpportunityKind
import com.trippilot.planbdetection.domain.OpportunityQuery
import com.trippilot.planbdetection.domain.OpportunitySlot
import io.kotest.assertions.throwables.shouldThrow
import io.kotest.assertions.throwables.shouldThrowAny
import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.collections.shouldBeEmpty
import io.kotest.matchers.collections.shouldContainExactly
import io.kotest.matchers.longs.shouldBeGreaterThanOrEqual
import io.kotest.matchers.longs.shouldBeLessThan
import io.kotest.matchers.shouldBe
import io.kotest.matchers.string.shouldNotBeBlank
import io.kotest.matchers.types.shouldBeInstanceOf
import org.springframework.web.client.ResourceAccessException
import org.springframework.web.client.RestClientException
import java.net.InetSocketAddress
import java.net.ServerSocket
import java.net.Socket
import java.net.SocketTimeoutException
import java.time.Clock
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneOffset
import java.util.UUID
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/**
 * 기회 HTTP 어댑터 — 실 소켓으로 **와이어 왕복**을 잰다(HttpReminderCopyAdapterTest 선례).
 *
 * 포트 대역으로는 원리적으로 못 보는 것들이다: 경계 매퍼(snake_case·Jackson 3 Kotlin 모듈)를 지난 실제 본문,
 * 상대가 이상한 것을 줬을 때 **예외로 말하는가**(기본값으로 채워 정상처럼 넘기지 않는가), 읽기 상한이 실제로 걸렸는가.
 * 어댑터는 `@Bean` 이 만드는 그대로 쓴다 — 테스트가 클라이언트를 따로 조립하면 운영 경로의 설정을 아무도 안 잰다.
 * 설정도 운영 기본값 그대로다 — 테스트가 시한·상한을 다시 적어 넘기면 기본값을 바꿔도(읽기 상한 10분 등) 전부 초록이었다.
 */
class HttpOpportunityAdapterTest : StringSpec({

    val date = LocalDate.parse("2026-10-20")
    val p1 = UUID.fromString("e0000000-0000-4000-8000-000000000001")
    val p2 = UUID.fromString("e0000000-0000-4000-8000-000000000007")
    val query = OpportunityQuery(
        date,
        listOf(OpportunitySlot("$date#$p1", p1, 33.4587, 126.9427), OpportunitySlot("$date#$p2", p2, 33.5285, 126.7714)),
        listOf(p1, p2),
    )
    val clock = Clock.fixed(Instant.parse("2026-10-20T03:00:00Z"), ZoneOffset.UTC)
    val mapper = OpportunityConfiguration.boundaryMapper()

    /** 연결·시한·읽기 상한은 운영 기본값 그대로다(위 KDoc). */
    fun adapter(baseUrl: String, token: String = "") =
        OpportunityConfiguration().httpOpportunityPort(OpportunityProperties(mode = "http", baseUrl = baseUrl, serviceToken = token), clock)

    "@Bean 이 실 HTTP 어댑터를 낸다" {
        adapter("http://127.0.0.1:1").shouldBeInstanceOf<HttpOpportunityAdapter>()
    }

    "요청은 계약 키(snake_case)로 나간다 — 날짜·남은 슬롯·계획 POI·시한" {
        withServer(reply()) { url, seen ->
            adapter(url).find(query)

            val body = mapper.readTree(seen.single().body)
            body["date"].asString() shouldBe "2026-10-20"
            body["slots"][0]["slot_key"].asString() shouldBe "$date#$p1"
            body["slots"][0]["poi_id"].asString() shouldBe p1.toString()
            body["slots"][0]["coord"]["lat"].asDouble() shouldBe 33.4587
            body["slots"][0]["coord"]["lng"].asDouble() shouldBe 126.9427
            body["slots"].size() shouldBe 2
            body["planned_poi_ids"].map { it.asString() } shouldContainExactly listOf(p1.toString(), p2.toString())
            body["request_meta"]["request_id"].asString().shouldNotBeBlank()
            body["request_meta"]["requested_at"].asString() shouldBe "2026-10-20T03:00:00Z"
            // 상대는 이 시한의 70% 안에서 장소 조회를 끊는다(PERF-SA-08) — 빠지면 시한 없이 8회를 다 돈다.
            body["request_meta"]["deadline_ms"].asLong() shouldBe 3_000
            seen.single().path shouldBe "/ai/v1/planb/opportunities"
        }
    }

    "응답을 도메인 값으로 읽는다 — 행사 기간은 일 단위, 요즘 인기는 행사 필드가 없다" {
        val venue = """{"key":"event:tourapi-1","kind":"EVENT_VENUE","event_name":"제주 들불축제","start":"2026-10-18",
            "end":"2026-10-25","poi_id":"e0000000-0000-4000-8000-000000000012","poi_name":"새별오름",
            "near_slot_key":"$date#$p1","distance_label":"약 1.0km"}"""
        val trending = """{"key":"trending:e0000000-0000-4000-8000-000000000003","kind":"TRENDING","event_name":null,
            "start":null,"end":null,"poi_id":"e0000000-0000-4000-8000-000000000003","poi_name":"월정리 카페거리",
            "near_slot_key":"$date#$p2","distance_label":"약 400m"}"""
        withServer(reply(items = "$venue,$trending", notes = "\"events_low\"")) { url, _ ->
            val out = adapter(url).find(query)

            out.items shouldContainExactly listOf(
                Opportunity(
                    "event:tourapi-1", OpportunityKind.EVENT_VENUE, "제주 들불축제", LocalDate.parse("2026-10-18"),
                    LocalDate.parse("2026-10-25"), UUID.fromString("e0000000-0000-4000-8000-000000000012"), "새별오름",
                    "$date#$p1", "약 1.0km",
                ),
                Opportunity(
                    "trending:e0000000-0000-4000-8000-000000000003", OpportunityKind.TRENDING, null, null, null,
                    UUID.fromString("e0000000-0000-4000-8000-000000000003"), "월정리 카페거리", "$date#$p2", "약 400m",
                ),
            )
            out.notes shouldContainExactly listOf("events_low")
        }
    }

    "빈 목록과 notes 도 그대로 읽는다 — 재료 실패는 상대가 200 + notes 로 말한다" {
        withServer(reply(notes = "\"poi_lookup_unavailable: TimeoutError\"")) { url, _ ->
            val out = adapter(url).find(query)

            out.items.shouldBeEmpty()
            out.notes shouldContainExactly listOf("poi_lookup_unavailable: TimeoutError")
        }
    }

    /** 모르는 종류를 기본값으로 흡수하면 계약 드리프트가 정상 동작으로 위장된다 — 실패로 올린다. */
    "모르는 kind 는 예외다" {
        withServer(reply(items = item(kind = "POPUP"))) { url, _ ->
            shouldThrow<IllegalArgumentException> { adapter(url).find(query) }
        }
    }

    "poi_id 가 UUID 가 아니면 예외다 — 앱이 그 장소를 일정에서 찾지 못한다" {
        withServer(reply(items = item(poiId = "poi-123"))) { url, _ ->
            shouldThrow<IllegalArgumentException> { adapter(url).find(query) }
        }
    }

    "필수 필드가 빠지면 예외다 — 빈 값으로 채워 넘기지 않는다" {
        val missing = """{"key":"trending:x","kind":"TRENDING","poi_id":"${UUID.randomUUID()}","poi_name":"카페","distance_label":"약 300m"}"""
        withServer(reply(items = missing)) { url, _ ->
            shouldThrowAny { adapter(url).find(query) }
        }
    }

    "200 인데 본문이 비면 예외다 — '기회 없음'으로 읽지 않는다" {
        withServer("") { url, _ ->
            shouldThrowAny { adapter(url).find(query) }
        }
    }

    "상대가 5xx 면 예외다 — 접는 것은 서비스 몫이다" {
        withServer(null) { url, _ ->
            shouldThrowAny { adapter(url).find(query) }
        }
    }

    /**
     * 읽기 상한이 운영 기본값으로 걸려 있어야 한다 — 없으면 상대가 멈췄을 때 허브 요청이 그 스레드를 붙잡고 매달린다.
     * 기본값 그대로 태우므로 상한만큼 걸린다 — 느린 이유가 곧 재는 내용이다(anti-patterns `@Bean` 운영 경로).
     */
    "읽기 상한(운영 기본 9s)에서 끊긴다 — 붙여 놓고 답하지 않는 상대에 매달리지 않는다" {
        val release = CountDownLatch(1)
        withServer(reply(), hold = release) { url, _ ->
            val began = System.nanoTime()
            // 응답 머리를 본문 읽기에서 늦게 읽어 ResourceAccessException 이 아니라 그 상위 RestClientException 으로 온다(실측).
            val thrown = try {
                shouldThrow<RestClientException> { adapter(url).find(query) }
            } finally {
                release.countDown()
            }
            val elapsed = TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - began)

            thrown.cause.shouldBeInstanceOf<SocketTimeoutException>()
            elapsed shouldBeGreaterThanOrEqual 9_000L
            elapsed shouldBeLessThan 10_500L
        }
    }

    /**
     * 연결 상한도 운영 기본값으로 걸려 있어야 한다 — 상대가 SYN 을 버리면(파드 교체·네트워크 분리) 상한이 없을 때
     * OS 재시도(리눅스 약 2분)까지 허브 요청이 매달린다. 위 읽기 상한 테스트는 연결이 즉시 맺어져 이 설정을 재지 못한다.
     */
    "연결 상한(운영 기본 1s)에서 끊긴다 — 연결이 맺어지지 않는 상대에 매달리지 않는다" {
        withUnconnectable { url ->
            val began = System.nanoTime()
            val thrown = shouldThrow<ResourceAccessException> { adapter(url).find(query) }
            val elapsed = TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - began)

            thrown.cause.shouldBeInstanceOf<SocketTimeoutException>()
            elapsed shouldBeGreaterThanOrEqual 1_000L
            elapsed shouldBeLessThan 2_500L
        }
    }

    "서비스 토큰을 설정하면 X-Service-Token 이 실리고, 비면 헤더를 싣지 않는다" {
        withServer(reply()) { url, seen ->
            adapter(url, token = "s3cr3t").find(query)
            adapter(url, token = "").find(query)

            seen.map { it.token } shouldContainExactly listOf("s3cr3t", null)
        }
    }

    "헤더 이름은 계약이다 — X-Service-Token" {
        OpportunityConfiguration.SERVICE_TOKEN_HEADER shouldBe "X-Service-Token"
    }

    "읽기 상한이 마감 + 상대 백스톱(5s)보다 작으면 기동하지 않는다 — 상대가 정리하는 응답을 먼저 끊는다" {
        shouldThrow<IllegalArgumentException> { OpportunityProperties(deadlineMs = 3_000, readTimeoutMs = 7_999) }
        OpportunityProperties(deadlineMs = 3_000, readTimeoutMs = 8_000).readTimeoutMs shouldBe 8_000
    }

    "모르는 모드는 기동하지 않는다 — 켰다고 믿는데 꺼진 채 도는 것보다 낫다" {
        shouldThrow<IllegalArgumentException> { OpportunityProperties(mode = "on") }
        OpportunityProperties(mode = "HTTP").mode shouldBe "HTTP" // 조건부 빈의 비교처럼 대소문자는 가리지 않는다
    }

    /**
     * 값이 조용히 늘면 '상한이 있다'는 사실만 남고 실효가 사라진다 — 바꿀 때는 근거와 함께 이 줄을 고친다.
     * 읽기 상한 9s = 시한 3s + 상대 백스톱 5s + 1s(리마인드 14s·회고 21s 와 같은 꼴) — 백스톱과 같으면 상대의 504 보다
     * 우리 소켓이 먼저 끊긴다(우리 시계가 상대보다 먼저 출발한다).
     */
    "운영 기본값은 꺼짐 · 연결 1s · 시한 3s · 읽기 상한 9s 다" {
        OpportunityProperties().let { listOf(it.mode, it.connectTimeoutMs, it.deadlineMs, it.readTimeoutMs) } shouldBe
            listOf("off", 1_000L, 3_000L, 9_000L)
    }
})

private data class Seen(val path: String, val body: String, val token: String?)

private fun item(kind: String = "TRENDING", poiId: String = UUID.randomUUID().toString()) =
    """{"key":"trending:$poiId","kind":"$kind","event_name":null,"start":null,"end":null,"poi_id":"$poiId",
        "poi_name":"카페","near_slot_key":"2026-10-20#x","distance_label":"약 300m"}"""

private fun reply(items: String = "", notes: String = "") = """{"opportunities":[$items],"notes":[$notes]}"""

/** [json] 이 null 이면 503 — 상대 장애를 흉내 낸다. [hold] 를 주면 그것이 풀릴 때까지 응답을 붙잡는다. */
private fun withServer(json: String?, hold: CountDownLatch? = null, block: (baseUrl: String, seen: List<Seen>) -> Unit) {
    val seen: MutableList<Seen> = java.util.Collections.synchronizedList(mutableListOf())
    val server = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0)
    server.createContext("/") { ex ->
        seen += Seen(ex.requestURI.path, ex.requestBody.readBytes().decodeToString(), ex.requestHeaders.getFirst("X-Service-Token"))
        hold?.await(15, TimeUnit.SECONDS)
        if (json == null) {
            ex.sendResponseHeaders(503, -1)
        } else {
            val bytes = json.toByteArray()
            ex.responseHeaders.add("Content-Type", "application/json")
            ex.sendResponseHeaders(200, bytes.size.toLong())
            ex.responseBody.use { it.write(bytes) }
        }
        ex.close()
    }
    server.executor = java.util.concurrent.Executors.newCachedThreadPool()
    server.start()
    try {
        block("http://127.0.0.1:${server.address.port}", seen)
    } finally {
        server.stop(0)
    }
}

/**
 * 연결이 맺어지지 않는 상대 — accept 하지 않는 리스너의 백로그를 채우면 그다음 SYN 은 커널이 버린다
 * (백로그 1 에 리눅스는 2개·macOS 는 1개로 찬다 — 실측). 루프백에서 'SYN 을 버리는 상대'를 결정론으로 만든다.
 */
private fun withUnconnectable(block: (baseUrl: String) -> Unit) {
    val server = ServerSocket()
    server.bind(InetSocketAddress("127.0.0.1", 0), 1)
    val fillers = mutableListOf<Socket>()
    try {
        while (true) {
            val s = Socket()
            try {
                s.connect(server.localSocketAddress, 500)
            } catch (full: SocketTimeoutException) {
                s.close()
                break
            }
            fillers += s
            check(fillers.size < 64) { "백로그가 차지 않습니다 — 이 환경에서는 맺어지지 않는 연결을 만들 수 없습니다." }
        }
        block("http://127.0.0.1:${server.localPort}")
    } finally {
        fillers.forEach { runCatching { it.close() } }
        server.close()
    }
}
