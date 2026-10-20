package com.trippilot.weathercontext.adapter.out.external

import ch.qos.logback.classic.Logger
import ch.qos.logback.classic.spi.ILoggingEvent
import ch.qos.logback.core.read.ListAppender
import com.sun.net.httpserver.HttpServer
import com.trippilot.weathercontext.api.AirGrade
import com.trippilot.weathercontext.api.AirRegion
import com.trippilot.weathercontext.domain.WeatherGatewayRefused
import com.trippilot.weathercontext.domain.WeatherLookupFailed
import io.kotest.assertions.throwables.shouldThrow
import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.nulls.shouldBeNull
import io.kotest.matchers.shouldBe
import io.kotest.matchers.string.shouldContain
import io.kotest.matchers.string.shouldNotContain
import org.slf4j.LoggerFactory
import org.springframework.http.client.SimpleClientHttpRequestFactory
import org.springframework.web.client.RestClient
import java.net.InetSocketAddress
import java.time.Duration
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.ZoneId
import java.util.Collections

/**
 * 에어코리아 대기질 예보통보 어댑터(`getMinuDustFrcstDspth` · 설계서 T-D2-U 대기질) — 실 소켓, 실응답 표본 두 벌.
 *
 * 표본(2026-10-19 · 키 없음)은 PM10·PM25 요청 둘이 **같은 본문**이다 — 응답이 요청한 통보 코드만 주지 않고 PM10·PM25·O3 와
 * 그 날 발표분(05·11시)을 다 준다. 그래서 PM10 으로 한 번 묻고 PM10·PM25 줄을 다 읽는다(PM25 줄이 없을 때만 따로 묻는다).
 * (코드, 예보 날짜)마다 가장 최근 발표분을 쓴다.
 * 등급 문자열은 바꾸지 않는다(공공누리 3유형 · 변경 금지 — BR-SA-24).
 */
class AirKoreaAdapterTest : StringSpec({

    "실응답 표본 — 오늘·내일 19 권역 등급, 가장 최근(11시) 발표분, 등급 문자열 그대로" {
        withAirServer(mapOf("PM10" to listOf(airOk(airSample("pm10"))), "PM25" to listOf(airOk(airSample("pm25"))))) { url, hits ->
            val forecast = airAdapter(url).fetchAirForecast(TODAY)

            forecast.byDate.keys shouldBe setOf(TODAY, TOMORROW)
            forecast.byDate.getValue(TODAY).size shouldBe 19
            forecast.byDate.getValue(TOMORROW).size shouldBe 19
            forecast.byDate.getValue(TODAY)[AirRegion.SEOUL] shouldBe AirGrade(pm10 = "좋음", pm25 = "좋음")
            forecast.byDate.getValue(TOMORROW)[AirRegion.CHUNGNAM] shouldBe AirGrade(pm10 = "좋음", pm25 = "보통")
            forecast.byDate.getValue(TOMORROW)[AirRegion.GYEONGGI_SOUTH] shouldBe AirGrade(pm10 = "좋음", pm25 = "보통")
            forecast.byDate.getValue(TOMORROW)[AirRegion.YEONGDONG] shouldBe AirGrade(pm10 = "좋음", pm25 = "좋음")
            forecast.issuedAt shouldBe kst("2026-10-19T11:00")
            hits.size shouldBe 1 // 한 벌에 PM10·PM25 가 다 있다 — 한 번만 묻는다(COST-SA-04)
        }
    }

    "질의 — 오늘 날짜 PM10 으로 한 번, 키는 인코딩해서 JSON 으로 묻는다(응답이 PM25 도 준다)" {
        withAirServer(mapOf("PM10" to listOf(airOk(airSample("pm10"))), "PM25" to listOf(airOk(airSample("pm25"))))) { url, hits ->
            airAdapter(url, key = "AB+C/D==").fetchAirForecast(TODAY)

            hits.map { it.substringAfter("InformCode=").substringBefore('&') } shouldBe listOf("PM10")
            hits.single() shouldContain "searchDate=2026-10-19"
            hits.single() shouldContain "returnType=json"
            hits.single() shouldContain "serviceKey=AB%2BC%2FD%3D%3D"
        }
    }

    /** 원천이 요청 코드만 주게 바뀌어도 PM25 를 잃지 않는다 — 첫 응답에 PM25 줄이 없을 때만 따로 묻는다. */
    "첫 응답에 PM25 줄이 없으면 PM25 를 따로 묻는다 — 두 번" {
        val pm10 = airBody(airItem("PM10", "2026-10-19", "2026-10-19 11시 발표", "제주 : 보통"))
        val pm25 = airBody(airItem("PM25", "2026-10-19", "2026-10-19 11시 발표", "제주 : 나쁨"))
        withAirServer(mapOf("PM10" to listOf(airOk(pm10)), "PM25" to listOf(airOk(pm25)))) { url, hits ->
            airAdapter(url).fetchAirForecast(TODAY).byDate.getValue(TODAY)[AirRegion.JEJU] shouldBe AirGrade(pm10 = "보통", pm25 = "나쁨")

            hits.map { it.substringAfter("InformCode=").substringBefore('&') } shouldBe listOf("PM10", "PM25")
        }
    }

    "같은 (코드, 예보 날짜)의 발표분이 여럿이면 가장 최근 것 — 앞서 온 05시 '나쁨' 이 11시 '보통' 을 이기지 않는다" {
        val pm10 = airBody(
            airItem("PM10", "2026-10-20", "2026-10-19 11시 발표", "제주 : 보통,서울 : 좋음"),
            airItem("PM10", "2026-10-20", "2026-10-19 05시 발표", "제주 : 나쁨,서울 : 매우나쁨"),
        )
        val pm25 = airBody(airItem("PM25", "2026-10-20", "2026-10-19 05시 발표", "제주 : 매우나쁨"))
        withAirServer(mapOf("PM10" to listOf(airOk(pm10)), "PM25" to listOf(airOk(pm25)))) { url, _ ->
            val tomorrow = airAdapter(url).fetchAirForecast(TODAY).byDate.getValue(TOMORROW)

            tomorrow[AirRegion.JEJU] shouldBe AirGrade(pm10 = "보통", pm25 = "매우나쁨")
            tomorrow[AirRegion.SEOUL] shouldBe AirGrade(pm10 = "좋음", pm25 = null) // PM25 줄에 서울이 없다 — 모름이다
        }
    }

    "응답의 다른 코드(O3 등)는 읽지 않는다 — PM10 줄은 PM10, PM25 줄은 PM25 로만" {
        val all = airBody(
            airItem("O3", "2026-10-19", "2026-10-19 11시 발표", "제주 : 매우나쁨"),
            airItem("PM25", "2026-10-19", "2026-10-19 11시 발표", "제주 : 좋음"),
            airItem("PM10", "2026-10-19", "2026-10-19 11시 발표", "제주 : 보통"),
        )
        withAirServer(mapOf("PM10" to listOf(airOk(all)), "PM25" to listOf(AirReply(500, "text/plain", "묻지 않는다")))) { url, hits ->
            airAdapter(url).fetchAirForecast(TODAY).byDate.getValue(TODAY)[AirRegion.JEJU] shouldBe AirGrade(pm10 = "보통", pm25 = "좋음")
            hits.size shouldBe 1
        }
    }

    "모르는 권역 이름·깨진 칸·날짜를 못 읽는 줄은 그것만 버린다 — 등급 문자열은 고치지 않는다" {
        val pm10 = airBody(
            airItem("PM10", "2026-10-19", "2026-10-19 11시 발표", "제주 : 매우나쁨, 전남광주 : 나쁨,서울 좋음,부산 : ,대구 : 예보없음"),
            airItem("PM10", "20261019", "2026-10-19 11시 발표", "울산 : 나쁨"),
            airItem("PM10", "2026-10-19", "어제 발표", "인천 : 나쁨"),
        )
        withAirServer(mapOf("PM10" to listOf(airOk(pm10)), "PM25" to listOf(airOk(airBody())))) { url, _ ->
            val today = airAdapter(url).fetchAirForecast(TODAY).byDate.getValue(TODAY)

            today shouldBe mapOf(AirRegion.JEJU to AirGrade("매우나쁨", null), AirRegion.DAEGU to AirGrade("예보없음", null))
        }
    }

    /**
     * 모르는 권역 이름은 그 칸만 버려 목적지 권역이 '등급 모름'이 된다(안전 쪽) — 다만 조용하면 권역 개편·이름 변화가 안 보인다.
     * 바뀔 때 WARN 한 번(한글 이름만 싣는다 — 본문에서 온 다른 글자는 싣지 않는다).
     */
    "모르는 권역 이름은 바뀔 때 WARN 한 번 — 같은 이름이 이어지면 조용하다" {
        val odd = airBody(
            airItem("PM10", "2026-10-19", "2026-10-19 11시 발표", "제주 : 좋음,전남광주 : 나쁨"),
            airItem("PM25", "2026-10-19", "2026-10-19 11시 발표", "제주 : 좋음,전남광주 : 나쁨"),
        )
        withAirServer(mapOf("PM10" to listOf(airOk(odd)), "PM25" to listOf(airOk(odd)))) { url, _ ->
            val adapter = airAdapter(url)
            val warns = airLogsOf {
                adapter.fetchAirForecast(TODAY)
                adapter.fetchAirForecast(TODAY)
            }.filter { "권역" in it }

            warns.size shouldBe 1
            warns.single() shouldContain "전남광주"
        }
    }

    "items 가 item 으로 한 번 더 감싸여 와도 읽는다" {
        val wrapped = """{"response":{"header":{"resultCode":"00","resultMsg":"NORMAL_CODE"},"body":{"items":{"item":[
            ${airItem("PM10", "2026-10-19", "2026-10-19 11시 발표", "제주 : 나쁨")}]},"numOfRows":100,"pageNo":1,"totalCount":1}}}"""
        withAirServer(mapOf("PM10" to listOf(airOk(wrapped)), "PM25" to listOf(airOk(airBody())))) { url, _ ->
            airAdapter(url).fetchAirForecast(TODAY).byDate.getValue(TODAY)[AirRegion.JEJU] shouldBe AirGrade("나쁨", null)
        }
    }

    "게이트웨이 거절이면 그 출처 거절이고 두 번째 코드는 묻지 않는다" {
        listOf(
            AirReply(200, "text/xml", GATEWAY_XML_30) to "30",
            AirReply(200, "application/json", GATEWAY_JSON_30) to "30",
            AirReply(403, "text/plain", "Forbidden") to "HTTP_403",
        ).forEach { (reply, code) ->
            withAirServer(mapOf("PM10" to listOf(reply), "PM25" to listOf(airOk(airSample("pm25"))))) { url, hits ->
                shouldThrow<WeatherGatewayRefused> { airAdapter(url).fetchAirForecast(TODAY) }.reasonCode shouldBe code
                hits.size shouldBe 1
            }
        }
    }

    "5xx · 깨진 본문 · 정상 아닌 결과 코드 · 두 코드 모두 등급 없음은 장애다 — 다시 묻지 않는다" {
        listOf(
            mapOf("PM10" to listOf(AirReply(503, "text/plain", "busy")), "PM25" to listOf(airOk(airSample("pm25")))) to 1,
            mapOf("PM10" to listOf(AirReply(200, "application/json", "{oops")), "PM25" to listOf(airOk(airSample("pm25")))) to 1,
            mapOf("PM10" to listOf(AirReply(200, "application/json", """{"response":{"header":{"resultCode":"03","resultMsg":"NO_DATA"}}}""")), "PM25" to listOf(airOk(airSample("pm25")))) to 1,
            mapOf("PM10" to listOf(airOk(airBody(airItem("PM10", "2026-10-19", "2026-10-19 11시 발표", "제주 : 보통")))), "PM25" to listOf(AirReply(500, "text/plain", "oops"))) to 2,
            mapOf("PM10" to listOf(airOk(airBody())), "PM25" to listOf(airOk(airBody()))) to 2,
        ).forEach { (replies, calls) ->
            withAirServer(replies) { url, hits ->
                shouldThrow<WeatherLookupFailed> { airAdapter(url).fetchAirForecast(TODAY) }
                hits.size shouldBe calls
            }
        }
    }

    /**
     * 게이트웨이·서버가 받은 질의(서비스 키)를 본문에 되돌려 줘도 예외·로그에 싣지 않는다(SEC-SA-03). 거절(XML 30) · 5xx · 깨진 JSON ·
     * 등급 없는 본문(권역 칸에 질의가 든다) 네 갈래 모두 원인 이름만 남는다.
     */
    "응답 본문이 질의(키)를 되돌려 줘도 예외·로그에 키가 실리지 않는다" {
        listOf<(String) -> AirReply>(
            { q -> AirReply(200, "text/xml", GATEWAY_XML_30.replace("</cmmMsgHeader>", "<echo>${q.replace("&", "&amp;")}</echo></cmmMsgHeader>")) },
            { q -> AirReply(503, "text/plain", "busy $q") },
            { q -> AirReply(200, "application/json", "{$q") },
            { q -> airOk(airBody(airItem("PM10", "2026-10-19", "2026-10-19 11시 발표", q), airItem("PM25", "2026-10-19", "2026-10-19 11시 발표", q))) },
        ).forEach { reply ->
            withAirEchoServer(reply) { url ->
                val logs = airLogsOf {
                    val e = shouldThrow<RuntimeException> { airAdapter(url, key = "SECRET+KEY==").fetchAirForecast(TODAY) }
                    e.message.orEmpty() shouldNotContain "SECRET"
                    e.message.orEmpty() shouldNotContain "serviceKey"
                }
                logs.isEmpty() shouldBe false // 실패 WARN 은 남았다 — 그 줄에도 키가 없다
                logs.forEach {
                    it shouldNotContain "SECRET"
                    it shouldNotContain "serviceKey"
                }
            }
        }
    }

    "연결 실패 예외에 요청 주소·키가 실리지 않는다" {
        val dead = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0).also { it.start() }
        val url = "http://127.0.0.1:${dead.address.port}"
        dead.stop(0)

        val e = shouldThrow<WeatherLookupFailed> { airAdapter(url, key = "SECRET+KEY==").fetchAirForecast(TODAY) }

        e.cause.shouldBeNull()
        e.message!! shouldNotContain "serviceKey"
        e.message!! shouldNotContain "SECRET"
        e.message!! shouldNotContain "127.0.0.1"
    }
})

// ── 픽스처 — 같은 패키지의 다른 테스트와 최상위 이름이 겹치지 않게 air 접두를 둔다 ──

private val TODAY: LocalDate = LocalDate.parse("2026-10-19")
private val TOMORROW: LocalDate = TODAY.plusDays(1)

private fun kst(local: String) = LocalDateTime.parse(local).atZone(ZoneId.of("Asia/Seoul")).toInstant()

/** 실응답 표본(2026-10-19 11시까지 발표분 — PM10·PM25·O3 × 05·11시 × 오늘·내일). 키는 없다. */
private fun airSample(code: String): String = object {}.javaClass.getResource("/public-data/airkorea_frcst_$code.json")!!.readText()

private fun airItem(code: String, date: String, dataTime: String, grades: String) =
    """{"informCode":"$code","informData":"$date","dataTime":"$dataTime","informGrade":"$grades","informCause":"○ …","informOverall":"○ …","actionKnack":null}"""

private fun airBody(vararg items: String) =
    """{"response":{"body":{"totalCount":${items.size},"items":[${items.joinToString(",")}],"pageNo":1,"numOfRows":100},"header":{"resultMsg":"NORMAL_CODE","resultCode":"00"}}}"""

private data class AirReply(val status: Int, val contentType: String, val body: String)

private fun airOk(body: String) = AirReply(200, "application/json", body)

private fun airAdapter(baseUrl: String, key: String = "테스트키") = AirKoreaAdapter(
    RestClient.builder()
        .requestFactory(
            SimpleClientHttpRequestFactory().apply {
                setConnectTimeout(Duration.ofSeconds(2)); setReadTimeout(Duration.ofSeconds(2))
            },
        ).build(),
    baseUrl, key,
)

/** 받은 질의(원문 그대로 — 키가 든다)를 [reply] 로 본문에 되돌려 주는 서버. */
private fun withAirEchoServer(reply: (query: String) -> AirReply, block: (baseUrl: String) -> Unit) {
    val server = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0)
    server.createContext("/getMinuDustFrcstDspth") { ex ->
        val r = reply(ex.requestURI.rawQuery ?: "")
        val bytes = r.body.toByteArray()
        ex.responseHeaders.add("Content-Type", r.contentType)
        ex.sendResponseHeaders(r.status, bytes.size.toLong().takeIf { it > 0 } ?: -1)
        ex.responseBody.use { if (bytes.isNotEmpty()) it.write(bytes) }
    }
    server.start()
    try {
        block("http://127.0.0.1:${server.address.port}")
    } finally {
        server.stop(0)
    }
}

/** 어댑터 로거의 기록(문장). */
private fun airLogsOf(block: () -> Unit): List<String> {
    val logger = LoggerFactory.getLogger(AirKoreaAdapter::class.java) as Logger
    val appender = ListAppender<ILoggingEvent>().apply { start() }
    logger.addAppender(appender)
    try {
        block()
    } finally {
        logger.detachAppender(appender)
    }
    return appender.list.map { it.formattedMessage }
}

/** 요청한 통보 코드(`InformCode`)마다 준비한 응답을 차례로 낸다(마지막 것은 계속 낸다). 받은 질의를 순서대로 모은다. */
private fun withAirServer(replies: Map<String, List<AirReply>>, block: (baseUrl: String, queries: List<String>) -> Unit) {
    val queues = replies.mapValues { (_, list) -> list.toMutableList() }
    val queries: MutableList<String> = Collections.synchronizedList(mutableListOf())
    val server = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0)
    server.createContext("/getMinuDustFrcstDspth") { ex ->
        val query = ex.requestURI.rawQuery ?: ""
        queries += query
        val queue = queues[query.substringAfter("InformCode=", "").substringBefore('&')]
        val reply = when {
            queue == null -> AirReply(400, "text/plain", "no InformCode")
            queue.size > 1 -> queue.removeAt(0)
            else -> queue.first()
        }
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
