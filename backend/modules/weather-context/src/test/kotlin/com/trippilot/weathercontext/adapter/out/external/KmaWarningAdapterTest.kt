package com.trippilot.weathercontext.adapter.out.external

import ch.qos.logback.classic.Level
import ch.qos.logback.classic.Logger
import ch.qos.logback.classic.spi.ILoggingEvent
import ch.qos.logback.core.read.ListAppender
import com.sun.net.httpserver.HttpServer
import com.trippilot.weathercontext.api.ActiveWarning
import com.trippilot.weathercontext.api.WarningArea
import com.trippilot.weathercontext.domain.WeatherGatewayRefused
import com.trippilot.weathercontext.domain.WeatherLookupFailed
import io.kotest.assertions.throwables.shouldThrow
import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.collections.shouldBeEmpty
import io.kotest.matchers.nulls.shouldBeNull
import io.kotest.matchers.shouldBe
import io.kotest.matchers.string.shouldContain
import io.kotest.matchers.string.shouldNotContain
import io.kotest.matchers.types.shouldBeSameInstanceAs
import org.slf4j.LoggerFactory
import org.springframework.http.client.SimpleClientHttpRequestFactory
import org.springframework.web.client.RestClient
import java.net.InetSocketAddress
import java.time.Duration
import java.util.concurrent.ConcurrentLinkedQueue

/**
 * 기상특보 현황 어댑터(`getPwnStatus` · 설계서 T-D2-U 특보) — 실 소켓으로 상대가 받은 질의·호출 수를 본다.
 * 호출 1건 = HTTP 1건, 실패는 재요청 없이 예외 — 게이트웨이 거절(그 출처 전체)과 장애·형식 깨짐을 가른다.
 */
class KmaWarningAdapterTest : StringSpec({

    "실응답 표본('o 없 음') — 특보 없음은 빈 목록이고, 질의는 키를 인코딩해 JSON 한 쪽을 묻는다" {
        withWarningServer(listOf(warningOk(warningSample()))) { url, hits ->
            warningAdapter(url, key = "AB+C/D==").fetchWarnings().shouldBeEmpty()

            hits.size shouldBe 1
            hits.single() shouldContain "serviceKey=AB%2BC%2FD%3D%3D" // `+` 를 그대로 두면 서버가 공백으로 읽어 403(anti-patterns)
            hits.single() shouldContain "dataType=JSON"
            hits.single() shouldContain "pageNo=1"
            hits.single() shouldContain "numOfRows=10"
        }
    }

    "발효 중 특보 — t6 를 줄마다 특보 하나로 읽는다" {
        val t6 = "o 강풍주의보 : 경상북도(영덕, 포항, 울진평지, 울진산지, 경주동부), 울산, 울릉도.독도\r\n o 호우주의보 : 경상남도(사천)"
        withWarningServer(listOf(warningOk(warningBulletin(t6)))) { url, _ ->
            warningAdapter(url).fetchWarnings() shouldBe listOf(
                ActiveWarning(
                    "강풍", "주의보",
                    listOf(
                        WarningArea("경상북도", listOf("영덕", "포항", "울진평지", "울진산지", "경주동부")),
                        WarningArea("울산"), WarningArea("울릉도.독도"),
                    ),
                ),
                ActiveWarning("호우", "주의보", listOf(WarningArea("경상남도", listOf("사천")))),
            )
        }
    }

    /** 같은 발표(발표 시각·순번)면 다시 파싱하지 않는다(COST-SA-03) — 같은 목록을 돌려준다. 순번이 바뀌면 새로 읽는다. */
    "같은 tmFc·tmSeq 면 앞서 읽은 목록을 그대로 쓰고, 순번이 바뀌면 다시 읽는다" {
        val first = warningBulletin("o 강풍주의보 : 울산", tmSeq = 112)
        val same = warningBulletin("o 강풍주의보 : 울산", tmSeq = 112)
        val next = warningBulletin("o 강풍주의보 : 울산, 부산", tmSeq = 113)
        withWarningServer(listOf(warningOk(first), warningOk(same), warningOk(next))) { url, hits ->
            val adapter = warningAdapter(url)

            val a = adapter.fetchWarnings()
            val b = adapter.fetchWarnings()
            val c = adapter.fetchWarnings()

            hits.size shouldBe 3 // 호출은 매번 한다 — 아끼는 것은 파싱이다(20분 기억은 서비스 몫)
            b shouldBeSameInstanceAs a
            c.single().areas shouldBe listOf(WarningArea("울산"), WarningArea("부산"))
        }
    }

    "응답 줄이 여럿이면 가장 최근 발표(tmFc·tmSeq)를 읽는다" {
        val body = """{"response":{"header":{"resultCode":"00","resultMsg":"NORMAL_SERVICE"},"body":{"dataType":"JSON","items":{"item":[
            ${warningItem("o 강풍주의보 : 울산", tmFc = "202610191000", tmSeq = 111)},
            ${warningItem("o 호우주의보 : 부산", tmFc = "202610191200", tmSeq = 112)}
            ]},"pageNo":1,"numOfRows":10,"totalCount":2}}}"""
        withWarningServer(listOf(warningOk(body))) { url, _ ->
            warningAdapter(url).fetchWarnings().single().title shouldBe "호우주의보"
        }
    }

    /** 게이트웨이 거절 — JSON 을 요청해도 XML 본문으로 온다(2026-10-19 실측 30). 재요청 0 · 원인 코드만. */
    "게이트웨이 거절 표본 셋(XML 30 · JSON 30 · HTTP 401) — 그 출처 거절이고 다시 묻지 않는다" {
        listOf(
            WarningReply(200, "text/xml", GATEWAY_XML_30) to "30",
            WarningReply(200, "application/json", GATEWAY_JSON_30) to "30",
            WarningReply(401, "text/plain", "Unauthorized") to "HTTP_401",
        ).forEach { (reply, code) ->
            withWarningServer(listOf(reply)) { url, hits ->
                shouldThrow<WeatherGatewayRefused> { warningAdapter(url).fetchWarnings() }.reasonCode shouldBe code
                hits.size shouldBe 1
            }
        }
    }

    /** 장애·형식 깨짐 — 모름이다. 특히 t6 를 못 읽으면 '특보 없음'으로 접지 않는다(INV-SA-2). */
    "5xx · 깨진 본문 · 정상 아닌 결과 코드 · 응답 머리·항목·t6 없음 · 못 읽는 t6 는 장애다 — HTTP 1건" {
        listOf(
            WarningReply(503, "text/plain", "busy"),
            WarningReply(200, "application/json", "{not json"),
            WarningReply(200, "text/html", "<html>gateway timeout</html>"),
            WarningReply(200, "application/json", """{"response":{"header":{"resultCode":"03","resultMsg":"NO_DATA"}}}"""),
            WarningReply(200, "application/json", """{"response":{"header":{"resultCode":"99"}}}"""),
            WarningReply(200, "application/json", """{"OpenAPI_ServiceResponse":{"cmmMsgHeader":{"returnReasonCode":"12"}}}"""),
            WarningReply(200, "application/json", """{"response":{"header":{"resultCode":"00"},"body":{"items":{"item":[]}}}}"""),
            WarningReply(200, "application/json", """{"response":{"header":{"resultCode":"00"},"body":{"items":{"item":[{"tmFc":202610191200,"tmSeq":112}]}}}}"""),
            warningOk(warningBulletin("o 강풍특보 : 울산")),
            warningOk(warningBulletin("")),
        ).forEach { reply ->
            withWarningServer(listOf(reply)) { url, hits ->
                shouldThrow<WeatherLookupFailed> { warningAdapter(url).fetchWarnings() }
                hits.size shouldBe 1
            }
        }
    }

    /** 서비스 키가 질의에 실린다 — 연결 실패 예외에 주소가 남으면 로그로 키가 샌다(SEC-SA-03). 종류만 싣고 원인을 매달지 않는다. */
    "연결 실패 예외에 요청 주소·키가 실리지 않는다" {
        val dead = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0).also { it.start() }
        val url = "http://127.0.0.1:${dead.address.port}"
        dead.stop(0)

        val e = shouldThrow<WeatherLookupFailed> { warningAdapter(url, key = "SECRET+KEY==").fetchWarnings() }

        e.cause.shouldBeNull()
        e.message!! shouldNotContain "serviceKey"
        e.message!! shouldNotContain "SECRET"
        e.message!! shouldNotContain "127.0.0.1"
    }

    /** 상태 변화 WARN(OBS-SA-03) — 같은 원인이 이어지면 한 번, 풀리면 INFO, 다시 막히면 또 한 번. 원인 코드만 싣는다. */
    "같은 거절이 이어지면 WARN 한 번 · 풀렸다가 다시 막히면 또 한 번 · 장애로 바뀌어도 한 번" {
        withWarningServer(
            listOf(
                WarningReply(200, "text/xml", GATEWAY_XML_30), WarningReply(200, "text/xml", GATEWAY_XML_30),
                warningOk(warningSample()), WarningReply(200, "text/xml", GATEWAY_XML_30), WarningReply(503, "text/plain", "busy"),
            ),
        ) { url, _ ->
            val adapter = warningAdapter(url, key = "SECRET+KEY==")
            val logs = logsOf {
                repeat(2) { shouldThrow<WeatherGatewayRefused> { adapter.fetchWarnings() } }
                adapter.fetchWarnings()
                shouldThrow<WeatherGatewayRefused> { adapter.fetchWarnings() }
                shouldThrow<WeatherLookupFailed> { adapter.fetchWarnings() }
            }
            val warns = logs.filter { it.level == Level.WARN }.map { it.formattedMessage }

            warns.size shouldBe 3
            warns[0] shouldContain "30"
            warns[2] shouldContain "HTTP 503"
            logs.count { it.level == Level.INFO } shouldBe 1 // 회복
            logs.forEach { it.formattedMessage shouldNotContain "SECRET" }
        }
    }
})

// ── 픽스처 — 같은 패키지의 다른 테스트와 최상위 이름이 겹치지 않게 warning 접두를 둔다 ──

/** 실응답 표본(2026-10-19 12:00 발표 · 특보 없음 — `t6` 공백 변주 "o 없 음"). 키는 없다. */
private fun warningSample(): String = object {}.javaClass.getResource("/public-data/kma_pwn_status.json")!!.readText()

private fun warningItem(t6: String, tmFc: String = "202610191200", tmSeq: Int = 112): String {
    val escaped = t6.replace("\\", "\\\\").replace("\"", "\\\"").replace("\r", "\\r").replace("\n", "\\n")
    return """{"other":"o 없음\r\n","t6":"$escaped","t7":"o 없음","tmEf":"202610191500","tmFc":$tmFc,"tmSeq":$tmSeq}"""
}

/** 실응답 표본과 같은 모양의 특보 현황 — `t6` 만 바꾼다. */
private fun warningBulletin(t6: String, tmSeq: Int = 112): String =
    """{"response":{"header":{"resultCode":"00","resultMsg":"NORMAL_SERVICE"},"body":{"dataType":"JSON","items":{"item":[${warningItem(t6, tmSeq = tmSeq)}]},"pageNo":1,"numOfRows":10,"totalCount":1}}}"""

private data class WarningReply(val status: Int, val contentType: String, val body: String)

private fun warningOk(body: String) = WarningReply(200, "application/json", body)

private fun warningAdapter(baseUrl: String, key: String = "테스트키") = KmaWarningAdapter(
    RestClient.builder()
        .requestFactory(
            SimpleClientHttpRequestFactory().apply {
                setConnectTimeout(Duration.ofSeconds(2)); setReadTimeout(Duration.ofSeconds(2))
            },
        ).build(),
    baseUrl, key,
)

/** 받은 질의를 모으고, 준비한 응답을 차례로 낸다(마지막 것은 계속 낸다). */
private fun withWarningServer(replies: List<WarningReply>, block: (baseUrl: String, queries: List<String>) -> Unit) {
    val queue = ConcurrentLinkedQueue(replies)
    val queries = mutableListOf<String>()
    val server = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0)
    server.createContext("/getPwnStatus") { ex ->
        queries += ex.requestURI.rawQuery ?: ""
        val reply = if (queue.size > 1) queue.poll() else queue.peek()
        val bytes = reply.body.toByteArray()
        ex.responseHeaders.add("Content-Type", reply.contentType)
        ex.sendResponseHeaders(reply.status, bytes.size.toLong().takeIf { it > 0 } ?: -1)
        ex.responseBody.use { if (bytes.isNotEmpty()) it.write(bytes) }
    }
    server.start()
    try {
        block("http://127.0.0.1:${server.address.port}", queries)
    } finally {
        server.stop(0)
    }
}

/** 어댑터 로거의 기록을 모은다. */
private fun logsOf(block: () -> Unit): List<ILoggingEvent> {
    val logger = LoggerFactory.getLogger(KmaWarningAdapter::class.java) as Logger
    val appender = ListAppender<ILoggingEvent>().apply { start() }
    logger.addAppender(appender)
    try {
        block()
    } finally {
        logger.detachAppender(appender)
    }
    return appender.list.toList()
}
