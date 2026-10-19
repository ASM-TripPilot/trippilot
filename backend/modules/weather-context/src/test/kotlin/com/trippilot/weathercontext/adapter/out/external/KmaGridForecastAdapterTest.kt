package com.trippilot.weathercontext.adapter.out.external

import ch.qos.logback.classic.Level
import ch.qos.logback.classic.Logger
import ch.qos.logback.classic.spi.ILoggingEvent
import ch.qos.logback.core.read.ListAppender
import com.sun.net.httpserver.HttpServer
import com.trippilot.placedata.api.RegionCenter
import com.trippilot.placedata.api.RegionLookupFacade
import com.trippilot.weathercontext.api.HourlyForecastUnavailable
import com.trippilot.weathercontext.application.HourlyForecastService
import com.trippilot.weathercontext.domain.GridDay
import com.trippilot.weathercontext.domain.GridForecast
import com.trippilot.weathercontext.domain.GridForecastMissing
import com.trippilot.weathercontext.domain.GridForecastPort
import com.trippilot.weathercontext.domain.GridForecastRepository
import com.trippilot.weathercontext.domain.GridHour
import com.trippilot.weathercontext.domain.WeatherGatewayRefused
import com.trippilot.weathercontext.domain.WeatherLookupFailed
import io.kotest.assertions.throwables.shouldThrow
import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.maps.shouldBeEmpty
import io.kotest.matchers.nulls.shouldBeNull
import io.kotest.matchers.shouldBe
import io.kotest.matchers.string.shouldContain
import io.kotest.matchers.string.shouldNotContain
import org.slf4j.LoggerFactory
import org.springframework.beans.factory.ObjectProvider
import org.springframework.http.client.SimpleClientHttpRequestFactory
import org.springframework.web.client.RestClient
import java.net.InetSocketAddress
import java.time.Clock
import java.time.Duration
import java.time.Instant
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.ZoneId
import java.time.ZoneOffset
import java.util.concurrent.ConcurrentLinkedQueue
import java.util.stream.Stream

/**
 * 기상청 단기예보 **격자 경로**(GridForecastPort · 상황 감지 단기예보 · 설계서 T-D2-U).
 *
 * 이름 경로([KmaWeatherAdapterTest])와 같은 실 소켓 방식이다 — 상대가 실제로 받은 질의·호출 수를 봐야 한다.
 * 호출 수가 이 경로의 비용 계약이다: 한 발표분 = HTTP 1건(03 이면 즉시 ≤2회 더), 게이트웨이 거절·장애는 재요청 0.
 */
class KmaGridForecastAdapterTest : StringSpec({

    "격자 키는 KmaGrid 의 nx,ny 다 — 제주 시청은 53,38" {
        gridAdapter("http://127.0.0.1:9").gridKeyOf(33.4996, 126.5312) shouldBe "53,38"
    }

    /**
     * 같은 getVilageFcst 응답 한 건에서 **오늘·내일**의 시간별(POP·PTY·SKY·TMP·WSD)과 날짜별(TMN·TMX)을 읽는다 — 추가 호출 0.
     * **모레는 시간별만** 담는다 — 저녁 회차가 보는 내일 슬롯이 자정을 넘기면(23:30 끝 → 모레 00시 칸) 판정 시각이 모레에 걸린다.
     * 모레의 최저·최고는 감시 지평(오늘·내일) 밖이라 담지 않는다.
     * 표본은 실측 변주대로 값이 문자열이고, 읽지 않는 카테고리(PCP·REH·SNO·UUU·VVV·WAV·VEC)와 모레 값이 섞여 있다.
     */
    "두 날짜 전 카테고리 표본에서 오늘·내일과 모레 시간별을 읽는다 — 모레 최저·최고와 읽지 않는 카테고리는 버린다" {
        withGridServer(listOf(okReply(fullSample()))) { url, hits ->
            val grid = gridAdapter(url).fetchGrid("53,38", AT)

            hits.size shouldBe 1
            hits.single() shouldContain "nx=53"
            hits.single() shouldContain "ny=38"
            hits.single() shouldContain "base_date=20261020"
            hits.single() shouldContain "base_time=0800"
            grid.gridKey shouldBe "53,38"
            grid.baseAt shouldBe kstAt("2026-10-20T08:00")
            grid.fetchedAt shouldBe AT
            grid.hourly[hourOf("2026-10-20T10:00")] shouldBe GridHour(pop = 60, pty = 1, sky = 4, tmp = 18.0, wsd = 3.2)
            grid.hourly[hourOf("2026-10-21T15:00")] shouldBe GridHour(pop = 10, pty = 0, sky = 1, tmp = 21.0, wsd = 1.5)
            grid.hourly[hourOf("2026-10-22T00:00")] shouldBe GridHour(pop = 20, pty = 0, sky = 3, tmp = 9.0, wsd = 2.0)
            grid.hourly.keys.map { it.toLocalDate() }.toSet() shouldBe setOf(TODAY, TOMORROW, TOMORROW.plusDays(1))
            // 오늘 최저(06시)는 08시 발표분에 없다 — 있는 것만 싣는다(지어내지 않는다).
            grid.daily shouldBe mapOf(TODAY to GridDay(tmn = null, tmx = 21.0), TOMORROW to GridDay(tmn = 10.0, tmx = 19.0))
        }
    }

    "모레 칸만 있는 정상 응답은 형식 깨짐이다 — 오늘·내일을 판정할 수 없는 예보를 캐시하지 않는다" {
        withGridServer(listOf(okReply(listOf(item("TMP", "20261022", "0000", "9"))))) { url, _ ->
            shouldThrow<WeatherLookupFailed> { gridAdapter(url).fetchGrid("53,38", AT) }
        }
    }

    /**
     * 숫자가 아니거나 범위 밖이면 **그 칸만** null 이다. 특히 결측 표식(-999 류)이 기온으로 들어오면 한파 오탐이 된다.
     * PTY 7(초단기 전용 눈날림)·SKY 2(2019년 폐지 구름조금)는 단기예보 코드가 아니다.
     */
    "정성 코드·결측 표식·SKY 2·PTY 7 은 그 칸만 모름이다" {
        val odd = listOf(
            item("POP", "20261020", "1100", "120"),
            item("PTY", "20261020", "1100", "7"),
            item("SKY", "20261020", "1100", "2"),
            item("TMP", "20261020", "1100", "-999"),
            item("WSD", "20261020", "1100", "약간 강"),
            item("POP", "20261020", "1200", "30"),
            item("PTY", "20261020", "1200", "4"),
            item("SKY", "20261020", "1200", "3"),
            item("TMP", "20261020", "1200", "19.5"),
            item("WSD", "20261020", "1200", "900"),
            item("TMX", "20261020", "1500", "강함"),
        )
        withGridServer(listOf(okReply(odd))) { url, _ ->
            val grid = gridAdapter(url).fetchGrid("53,38", AT)

            grid.hourly[hourOf("2026-10-20T11:00")] shouldBe GridHour(null, null, null, null, null)
            grid.hourly[hourOf("2026-10-20T12:00")] shouldBe GridHour(pop = 30, pty = 4, sky = 3, tmp = 19.5, wsd = null)
            grid.daily[TODAY] shouldBe GridDay(null, null)
        }
    }

    /** 칸 하나가 깨졌다고 발표분 전체를 버리면 그 격자가 다음 발표까지 모름이 된다 — 깨진 칸만 버린다. */
    "날짜·시각·카테고리·값이 깨진 칸은 그 칸만 버리고 나머지는 읽는다" {
        val broken = listOf(
            """{"category":"TMP","fcstDate":"2026-10-20","fcstTime":"1200","fcstValue":"20"}""", // 날짜 형식이 다르다
            """{"category":"TMP","fcstDate":"20261020","fcstTime":"12:00","fcstValue":"20"}""", // 시각 형식이 다르다
            """{"fcstDate":"20261020","fcstTime":"1200","fcstValue":"20"}""", // 카테고리 없음
            """{"category":"TMP","fcstDate":"20261020","fcstTime":"1200"}""", // 값 없음
            """{"category":{"name":"TMP"},"fcstDate":"20261020","fcstTime":"1300","fcstValue":"30"}""", // 카테고리가 객체
            """{"category":"WSD","fcstDate":"20261020","fcstTime":"1300","fcstValue":["3.0"]}""", // 값이 배열
            item("POP", "20261020", "1300", "-1"),
            item("PTY", "20261020", "1300", "-1"),
            item("TMP", "20261020", "1300", "21.5"),
        )
        withGridServer(listOf(okReply(broken))) { url, _ ->
            val grid = gridAdapter(url).fetchGrid("53,38", AT)

            grid.hourly shouldBe mapOf(hourOf("2026-10-20T13:00") to GridHour(pop = null, pty = null, sky = null, tmp = 21.5, wsd = null))
        }
    }

    "03(NO_DATA) 이면 즉시 다시 묻는다 — 03 다음 00 이면 HTTP 2건이고 같은 발표분을 묻는다" {
        withGridServer(listOf(resultReply("03"), okReply(fullSample()))) { url, hits ->
            val grid = gridAdapter(url).fetchGrid("53,38", AT)

            hits.size shouldBe 2
            hits.distinct().size shouldBe 1
            grid.hourly.isEmpty() shouldBe false
        }
    }

    "03 이 세 번이면 그 격자는 모름이다 — HTTP 3건에서 멈춘다" {
        withGridServer(listOf(resultReply("03"), resultReply("03"), resultReply("03"), okReply(fullSample()))) { url, hits ->
            shouldThrow<GridForecastMissing> { gridAdapter(url).fetchGrid("53,38", AT) }

            hits.size shouldBe 3
        }
    }

    /**
     * 파드당 하루 상한은 **격자 경로만** 센다(COST-SA-02) — 이름 경로(날씨 확인)·도우미 날씨 카드는 세지 않는다.
     * 넘으면 부르지 않는다(HTTP 0) — 그 격자는 모름이고 WARN 은 하루 한 번이다.
     */
    "격자 경로 하루 상한 — 넘으면 HTTP 0 이고 이름 경로는 상한과 무관하다" {
        withGridServer(listOf(okReply(fullSample()))) { url, hits ->
            val adapter = gridAdapter(url, cap = 2)
            val warns = warningsOf {
                adapter.fetchGrid("53,38", AT)
                adapter.fetchGrid("60,127", AT)
                shouldThrow<GridForecastMissing> { adapter.fetchGrid("53,38", AT) }
                shouldThrow<GridForecastMissing> { adapter.fetchGrid("98,76", AT) }
            }
            hits.size shouldBe 2
            warns.size shouldBe 1 // 하루 한 번

            adapter.fetch("제주", AT) // 이름 경로 — 상한과 무관하게 부른다
            hits.size shouldBe 3

            adapter.fetchGrid("53,38", AT.plus(Duration.ofDays(1))) // KST 다음 날이면 다시 센다
            hits.size shouldBe 4
        }
    }

    "03 재요청도 상한에 든다 — 상한이 재요청 중에 닿으면 거기서 멈춘다" {
        withGridServer(listOf(resultReply("03"))) { url, hits ->
            shouldThrow<GridForecastMissing> { gridAdapter(url, cap = 2).fetchGrid("53,38", AT) }

            hits.size shouldBe 2
        }
    }

    /**
     * 만료 = 발표 + 3시간 + 10분 — 다음 발표가 실제로 제공되는 시각이다. 08:05 에는 08시 발표가 아직 제공 전이라
     * 05시 발표분을 받고, 그 값은 08:10(08시 발표분 제공)까지 신선하다.
     */
    "만료 경계 — 08:05 호출은 05시 발표분을 받고 08:10 까지 신선하다" {
        withGridServer(listOf(okReply(fullSample()))) { url, hits ->
            val grid = gridAdapter(url).fetchGrid("53,38", kstAt("2026-10-20T08:05"))

            hits.single() shouldContain "base_time=0500"
            grid.expiresAt shouldBe kstAt("2026-10-20T08:10")
            grid.isFreshAt(kstAt("2026-10-20T08:10").minusMillis(1)) shouldBe true
            grid.isFreshAt(kstAt("2026-10-20T08:10")) shouldBe false
        }
    }

    "자정 직후에는 어제 23시 발표분에서 오늘·내일을 고른다" {
        val items = listOf(
            item("TMP", "20261019", "2300", "11"), // 어제 — 버린다
            item("TMP", "20261020", "0100", "10"),
            item("TMP", "20261021", "0100", "9"),
        )
        withGridServer(listOf(okReply(items))) { url, hits ->
            val grid = gridAdapter(url).fetchGrid("53,38", kstAt("2026-10-20T00:20"))

            hits.single() shouldContain "base_date=20261019"
            hits.single() shouldContain "base_time=2300"
            grid.hourly.keys shouldBe setOf(hourOf("2026-10-20T01:00"), hourOf("2026-10-21T01:00"))
        }
    }

    "정상 코드인데 오늘·내일 칸이 하나도 없으면 형식 깨짐이다 — 빈 예보를 정상으로 캐시하지 않는다" {
        withGridServer(listOf(okReply(listOf(item("TMP", "20261025", "1200", "20"))))) { url, _ ->
            shouldThrow<WeatherLookupFailed> { gridAdapter(url).fetchGrid("53,38", AT) }
        }
    }

    /**
     * 응답 머리(`response.header`)가 없는 JSON — 거절 코드가 아닌 게이트웨이 응답(12 서비스 없음 · 99 기타 등)이 이 모양이다.
     * 라이브러리 예외가 그대로 새면 호출측이 장애로 갈라 받지 못한다(실패 격자 기억을 비켜 간다).
     */
    "5xx·깨진 본문·모르는 결과 코드·응답 머리 없는 본문은 장애다 — 다시 묻지 않는다(HTTP 1건)" {
        listOf(
            Reply(503, "text/plain", "busy"),
            Reply(200, "application/json", "{not json"),
            Reply(200, "text/html", "<html>gateway timeout</html>"),
            resultReply("99"),
            Reply(404, "text/plain", "no such api"),
            Reply(200, "application/json", gatewayJson("12")),
            Reply(200, "application/json", gatewayJson("99")),
            Reply(200, "application/json", """{"response":{"header":{"resultCode":{"code":"00"}}}}"""),
        ).forEach { reply ->
            withGridServer(listOf(reply)) { url, hits ->
                shouldThrow<WeatherLookupFailed> { gridAdapter(url).fetchGrid("53,38", AT) }
                hits.size shouldBe 1
            }
        }
    }

    /**
     * 서비스 키가 질의 문자열에 실린다 — 연결 실패 예외의 메시지·원인에 요청 주소가 남으면 로그로 키가 샌다(SEC-SA-03).
     * 그래서 이 경로의 예외에는 원인 **종류**만 싣고 원인 예외를 매달지 않는다.
     */
    "연결 실패 예외에 요청 주소·키가 실리지 않는다" {
        val dead = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0).also { it.start() }
        val url = "http://127.0.0.1:${dead.address.port}"
        dead.stop(0) // 닫힌 포트 — 연결 거부

        val e = shouldThrow<WeatherLookupFailed> { gridAdapter(url, key = "SECRET+KEY==").fetchGrid("53,38", AT) }

        e.cause.shouldBeNull()
        e.message!! shouldNotContain "serviceKey"
        e.message!! shouldNotContain "SECRET"
        e.message!! shouldNotContain "127.0.0.1"
    }

    /**
     * **게이트웨이 거절**(XML 30 · JSON 30 · HTTP 401) — 어댑터 + 읽기-통과 캐시를 실물로 묶어 끝까지 본다.
     * 결과는 그 출처의 모름(감지기 Unknown) · 캐시 없음 · 재요청 0 · WARN 1번(원인 코드만)이다.
     */
    "게이트웨이 거절 표본 셋 — 모름·캐시 없음·재요청 0·WARN 1번" {
        listOf(
            Reply(200, "text/xml", GATEWAY_XML_30) to "30",
            Reply(200, "application/json", GATEWAY_JSON_30) to "30",
            Reply(401, "text/plain", "Unauthorized") to "HTTP_401",
        ).forEach { (reply, code) ->
            withGridServer(listOf(reply)) { url, hits ->
                val cache = MemoryGrids()
                val service = HourlyForecastService(portOf(gridAdapter(url)), cache, FIXED_CLOCK)

                val warns = warningsOf {
                    shouldThrow<HourlyForecastUnavailable> { service.forecastForTrigger(33.4996, 126.5312, AT) }
                        .gatewayCode shouldBe code
                }

                hits.size shouldBe 1
                cache.rows.shouldBeEmpty()
                warns.size shouldBe 1
                warns.single().formattedMessage shouldContain code
                warns.single().formattedMessage shouldNotContain "serviceKey"
            }
        }
    }

    "같은 거절이 이어지면 WARN 은 한 번이고, 풀렸다가 다시 거절되면 또 한 번이다" {
        withGridServer(
            listOf(
                Reply(200, "text/xml", GATEWAY_XML_30), Reply(200, "text/xml", GATEWAY_XML_30),
                okReply(fullSample()), Reply(200, "text/xml", GATEWAY_XML_30),
            ),
        ) { url, _ ->
            val adapter = gridAdapter(url)
            val warns = warningsOf {
                repeat(2) { shouldThrow<WeatherGatewayRefused> { adapter.fetchGrid("53,38", AT) } }
                adapter.fetchGrid("53,38", AT)
                shouldThrow<WeatherGatewayRefused> { adapter.fetchGrid("53,38", AT) }
            }
            warns.size shouldBe 2
        }
    }
})

// ── 픽스처 — 이름에 grid 접두를 둔다(같은 패키지 최상위 선언 충돌 방지 · anti-patterns TRIP-178) ──

private val KST: ZoneId = ZoneId.of("Asia/Seoul")
private fun kstAt(local: String): Instant = LocalDateTime.parse(local).atZone(KST).toInstant()
private fun hourOf(local: String): LocalDateTime = LocalDateTime.parse(local)

/** KST 2026-10-20(화) 09:30 — 08시 발표분이 최신인 시각. */
private val AT: Instant = kstAt("2026-10-20T09:30")
private val TODAY: LocalDate = LocalDate.parse("2026-10-20")
private val TOMORROW: LocalDate = TODAY.plusDays(1)
private val FIXED_CLOCK: Clock = Clock.fixed(AT, ZoneOffset.UTC)

private val jejuRegions = object : RegionLookupFacade {
    override fun codesOf(regionName: String) = emptyList<String>()
    override fun isSelectableCode(regionCode: String) = false
    override fun centerOf(regionName: String) = if (regionName == "제주") RegionCenter(33.4996, 126.5312) else null
    override fun centerOfCode(regionCode: String) = null
}

private fun gridAdapter(baseUrl: String, cap: Int = 3_000, key: String = "테스트키") = KmaWeatherAdapter(
    jejuRegions,
    RestClient.builder().baseUrl(baseUrl)
        .requestFactory(
            SimpleClientHttpRequestFactory().apply {
                setConnectTimeout(Duration.ofSeconds(2)); setReadTimeout(Duration.ofSeconds(2))
            },
        ).build(),
    KmaWeatherProperties(mode = "kma", baseUrl = baseUrl, serviceKey = key, gridDailyCap = cap),
)

private fun portOf(adapter: GridForecastPort): ObjectProvider<GridForecastPort> = object : ObjectProvider<GridForecastPort> {
    override fun getObject(): GridForecastPort = adapter
    override fun getIfAvailable(): GridForecastPort = adapter
    override fun stream(): Stream<GridForecastPort> = Stream.of(adapter)
    override fun orderedStream(): Stream<GridForecastPort> = Stream.of(adapter)
}

/** 격자 캐시 대역 — 실 저장소처럼 격자당 1행을 덮는다. */
private class MemoryGrids : GridForecastRepository {
    val rows = linkedMapOf<String, GridForecast>()
    override fun find(gridKey: String) = rows[gridKey]
    override fun save(forecast: GridForecast) = forecast.also { rows[it.gridKey] = it }
}

private data class Reply(val status: Int, val contentType: String, val body: String)

private fun item(category: String, date: String, time: String, value: String) =
    """{"baseDate":"20261020","baseTime":"0800","category":"$category","fcstDate":"$date","fcstTime":"$time","fcstValue":"$value","nx":53,"ny":38}"""

private fun okReply(items: List<String>) = Reply(
    200, "application/json",
    """{"response":{"header":{"resultCode":"00","resultMsg":"NORMAL_SERVICE"},
       "body":{"dataType":"JSON","items":{"item":[${items.joinToString(",")}]},"pageNo":1,"numOfRows":1500,"totalCount":${items.size}}}}""",
)

private fun resultReply(code: String) =
    Reply(200, "application/json", """{"response":{"header":{"resultCode":"$code","resultMsg":"NO_DATA"}}}""")

/** 거절 코드가 아닌 게이트웨이 응답의 JSON 모양 — 응답 머리(`response.header`)가 없다. */
private fun gatewayJson(code: String) =
    """{"OpenAPI_ServiceResponse":{"cmmMsgHeader":{"errMsg":"SERVICE ERROR","returnAuthMsg":"SERVICE ERROR","returnReasonCode":"$code"}}}"""

/**
 * 08시 발표분의 모양 — 오늘 10시·내일 10·15시·모레 0·10시, 카테고리 14종 전부. 오늘 최저(06시)는 발표 전이라 없다.
 */
private fun fullSample(): List<String> {
    fun hour(date: String, time: String, pop: String, pty: String, sky: String, tmp: String, wsd: String) = listOf(
        item("POP", date, time, pop), item("PTY", date, time, pty), item("PCP", date, time, "1.0mm"),
        item("REH", date, time, "85"), item("SNO", date, time, "적설없음"), item("SKY", date, time, sky),
        item("TMP", date, time, tmp), item("UUU", date, time, "-1.2"), item("VVV", date, time, "2.1"),
        item("WAV", date, time, "0"), item("VEC", date, time, "270"), item("WSD", date, time, wsd),
    )
    return hour("20261020", "1000", "60", "1", "4", "18", "3.2") +
        item("TMX", "20261020", "1500", "21.0") +
        item("TMN", "20261021", "0600", "10.0") +
        hour("20261021", "1000", "10", "0", "1", "15", "1.5") +
        hour("20261021", "1500", "10", "0", "1", "21", "1.5") +
        item("TMX", "20261021", "1500", "19.0") +
        hour("20261022", "0000", "20", "0", "3", "9", "2.0") +
        hour("20261022", "1000", "90", "1", "4", "12", "15.0") +
        item("TMN", "20261022", "0600", "-15.0") + item("TMX", "20261022", "1500", "36.0")
}

/** 받은 질의를 모으고, 준비한 응답을 차례로 낸다(마지막 것은 계속 낸다). */
private fun withGridServer(replies: List<Reply>, block: (baseUrl: String, queries: List<String>) -> Unit) {
    val queue = ConcurrentLinkedQueue(replies)
    val queries = mutableListOf<String>()
    val server = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0)
    server.createContext("/getVilageFcst") { ex ->
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

/** 어댑터 로거의 WARN 만 모은다. */
private fun warningsOf(block: () -> Unit): List<ILoggingEvent> {
    val logger = LoggerFactory.getLogger(KmaWeatherAdapter::class.java) as Logger
    val appender = ListAppender<ILoggingEvent>().apply { start() }
    logger.addAppender(appender)
    try {
        block()
    } finally {
        logger.detachAppender(appender)
    }
    return appender.list.filter { it.level == Level.WARN }
}
