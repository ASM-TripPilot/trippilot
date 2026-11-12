package com.trippilot.notification.adapter.out.external

import ch.qos.logback.classic.Level
import ch.qos.logback.classic.Logger
import ch.qos.logback.classic.spi.ILoggingEvent
import ch.qos.logback.core.read.ListAppender
import com.sun.net.httpserver.HttpServer
import com.trippilot.notification.domain.NotificationKind
import com.trippilot.notification.domain.ReminderCopy
import com.trippilot.notification.domain.ReminderCopyRequest
import com.trippilot.notification.domain.ReminderSlot
import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.maps.shouldBeEmpty
import io.kotest.matchers.shouldBe
import io.kotest.matchers.string.shouldContain
import org.slf4j.LoggerFactory
import org.springframework.http.client.SimpleClientHttpRequestFactory
import org.springframework.http.converter.json.JacksonJsonHttpMessageConverter
import org.springframework.web.client.RestClient
import java.net.InetSocketAddress
import java.time.Clock
import java.time.Duration
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneOffset

/**
 * 리마인드 문구 HTTP 어댑터의 **거르기 규칙**(TRIP-836).
 *
 * 포트 대역만 테스트하면 이 규칙들이 통째로 안 잡힌다 — 대역은 우리가 짜 준 것만 돌려주므로
 * "상대가 이상한 것을 줬을 때"를 원리적으로 재현하지 못한다. 그런데 이 어댑터가 하는 일의 절반이
 * 바로 그 경우를 거르는 것이다.
 *
 * 실 소켓으로 재는 이유: 매퍼(snake_case)를 지나는 왕복까지 봐야 한다. 이름이 어긋나면 응답이
 * 통째로 기본값이 되고, 그러면 **`degraded=false` 로 읽혀 상대의 규칙 문구를 AI 문구로 저장**한다.
 */
class HttpReminderCopyAdapterTest : StringSpec({

    // **재료(slots)가 있어야 묻는다** — 빈 재료로 물으면 상대가 "일정 없음"을 지어낸다(아래 스펙).
    val items = listOf(
        ReminderCopyRequest("키-1", NotificationKind.TRIP_DAY, LocalDate.parse("2026-08-10"), listOf(ReminderSlot("성산일출봉", "SIGHT"))),
        ReminderCopyRequest("키-2", NotificationKind.TRIP_PRE, LocalDate.parse("2026-08-09"), listOf(ReminderSlot("한라산"))),
    )

    "정상 응답의 문구를 키로 맞춰 돌려준다" {
        withServer(body(copies = """{"schedule_key":"키-1","title":"제목","body":"본문"}""")) { url ->
            val out = adapterAt(url).copiesFor("제주 여행", items)

            out.keys shouldBe setOf("키-1")
            out["키-1"]!!.title shouldBe "제목"
        }
    }

    /**
     * **`degraded` 여도 온 문구는 쓴다.** 계약은 "빠진 항목은 백엔드가 상수로 채운다 — degraded 가 그 증빙"이고,
     * 상대는 실패·게이트 탈락 항목만 빼고 통과한 문구는 그대로 준다(`fallback_mode=backend_constant`).
     * 종전엔 degraded 면 전부 버렸다 — 한 항목만 떨어져도 그 묶음의 멀쩡한 문구가 모두 상수가 됐다(운영 48시간 31건).
     */
    "degraded 응답이라도 온 문구는 쓴다 — 빠진 항목만 상수로 간다" {
        val b = """{"copies":[{"schedule_key":"키-1","title":"제목","body":"본문"}],
            "degraded":true,"fallback_mode":"backend_constant"}"""
        withServer(b) { url ->
            val out = adapterAt(url).copiesFor(null, items)

            out.keys shouldBe setOf("키-1")          // 키-2 는 상대가 빼 먹었다 — 문구 없이 남는다
            out["키-1"] shouldBe ReminderCopy("제목", "본문")
        }
    }

    "degraded 이고 온 문구가 없으면 빈 맵이다 — 전부 상수로 간다" {
        withServer(body(degraded = true)) { url ->
            adapterAt(url).copiesFor(null, items).shouldBeEmpty()
        }
    }

    /** degraded 여도 거르기 규칙은 그대로다 — 보낸 적 없는 키·빈 문구·긴 문구는 안 받는다. */
    "degraded 응답에서도 남의 키·빈 문구는 버린다" {
        val b = """{"copies":[
            {"schedule_key":"남의-키","title":"제목","body":"본문"},
            {"schedule_key":"키-1","title":"","body":"본문"},
            {"schedule_key":"키-2","title":"제목","body":"본문"}],
            "degraded":true,"fallback_mode":"backend_constant"}"""
        withServer(b) { url ->
            adapterAt(url).copiesFor(null, items).keys shouldBe setOf("키-2")
        }
    }

    /**
     * **보낸 적 없는 키는 버린다.** 안 버리면 엉뚱한 예약에 문구가 붙고, 증상이 사용자 화면에
     * "다른 날 이야기"로 나타나 원인을 되짚기 가장 어렵다.
     */
    "요청하지 않은 키는 버린다" {
        withServer(body(copies = """{"schedule_key":"남의-키","title":"제목","body":"본문"}""")) { url ->
            adapterAt(url).copiesFor(null, items).shouldBeEmpty()
        }
    }

    "빈 제목·본문은 버린다 — 빈 문구를 저장하면 발화가 그것을 쓴다" {
        withServer(body(copies = """{"schedule_key":"키-1","title":"","body":"본문"}""")) { url ->
            adapterAt(url).copiesFor(null, items).shouldBeEmpty()
        }
    }

    /**
     * 컬럼 폭(60·200)을 넘으면 **자르지 않고 버린다**. 잘린 문장을 사용자에게 보이느니 상수 문구가
     * 낫고, 자르면 저장은 되므로 **DB 가 막아 주지도 않는다**.
     */
    "컬럼 폭을 넘는 문구는 버린다" {
        val long = "가".repeat(61)
        withServer(body(copies = """{"schedule_key":"키-1","title":"$long","body":"본문"}""")) { url ->
            adapterAt(url).copiesFor(null, items).shouldBeEmpty()
        }
    }

    "상대가 5xx 면 빈 맵이다 — 예외가 위로 새면 예약 적재가 죽는다" {
        withServer(null) { url ->
            adapterAt(url).copiesFor(null, items).shouldBeEmpty()
        }
    }

    "보낼 항목이 없으면 부르지 않는다" {
        var hits = 0
        withServer(body(), onHit = { hits++ }) { url ->
            adapterAt(url).copiesFor(null, emptyList()).shouldBeEmpty()
        }
        hits shouldBe 0
    }

    /**
     * **`trip_title` 이 null 이면 키째로 빠져야 한다**(TRIP-836 후속).
     *
     * 계약이 `{"type":"string","default":""}` 라 **nullable 이 아니다**. `null` 을 실으면
     * `body.trip_title: Input should be a valid string` 으로 **매 호출이 422** 고, 어댑터가 그것을
     * 삼켜 상수 문구로 내려간다 — *"AI 를 켰는데 늘 상수 문구"* 라는 증상만 남는다.
     * 실 왕복을 태우고서야 알았다(2026-09-16).
     */
    "제목이 없으면 trip_title 키를 아예 안 보낸다" {
        withCapturingServer(body(copies = """{"schedule_key":"키-1","title":"제목","body":"본문"}""")) { url, sent ->
            adapterAt(url).copiesFor(null, items)

            sent.single().contains("trip_title") shouldBe false
        }
    }

    "제목이 있으면 그대로 싣는다" {
        withCapturingServer(body()) { url, sent ->
            adapterAt(url).copiesFor("제주 여행", items)

            sent.single() shouldContain "\"trip_title\":\"제주 여행\""
        }
    }

    /**
     * **`slots` 는 객체 배열이다.** 계약은 `ReminderSlotSchema[]`(`name` 필수)인데 문자열 배열로
     * 보내면 `Input should be a valid dictionary` 로 422 다. 계약 게이트가 **이름만** 대조해서
     * 이 어긋남을 못 봤다 — `slots` 라는 이름은 양쪽에 다 있다.
     */
    "slots 를 객체 배열로 보낸다 — 문자열 배열이 아니다" {
        withCapturingServer(body()) { url, sent ->
            adapterAt(url).copiesFor(null, items)

            // 카테고리가 있으면 함께 실린다(경계 코드 — 한글은 상대 사전에 없어 조용히 무시된다).
            sent.single() shouldContain "\"slots\":[{\"name\":\"성산일출봉\",\"category\":\"SIGHT\"}]"
            // 모르면 키 자체가 빠진다 — `null` 을 실으면 상대가 "카테고리가 비었다"로 읽는다.
            sent.single() shouldContain "\"slots\":[{\"name\":\"한라산\"}]"
        }
    }

    /**
     * **빈 재료로는 묻지 않는다.** 실측(2026-09-16 실 왕복): `slots=[]` 로 물었더니
     * *"오늘은 별도의 일정이 없으니 여유롭게…"* 가 돌아왔다 — 일정이 꽉 찬 날에 나가면 **거짓말**이다.
     * 상수 문구("오늘의 일정")는 밋밋해도 참이라, 묻지 않는 쪽이 낫다.
     */
    "재료가 빈 예약은 묻지 않는다 — 빈 입력에 상대가 '일정 없음'을 지어낸다" {
        val starved = listOf(ReminderCopyRequest("키-x", NotificationKind.TRIP_DAY, LocalDate.parse("2026-08-10")))
        var hits = 0
        withCapturingServer(body(), onHit = { hits++ }) { url, _ ->
            adapterAt(url).copiesFor(null, starved) shouldBe emptyMap()
        }

        hits shouldBe 0   // 호출 자체가 없다
    }

    /** 계약 enum 은 둘뿐이다 — 다른 종류가 한 건 섞이면 **요청 전체가** 422 다. */
    "계약 enum 밖 종류는 보내지 않는다" {
        val mixed = items + ReminderCopyRequest("키-3", NotificationKind.PLAN_B, LocalDate.parse("2026-08-11"), listOf(ReminderSlot("우도")))
        withCapturingServer(body()) { url, sent ->
            adapterAt(url).copiesFor(null, mixed)

            sent.single().contains("키-3") shouldBe false
            sent.single() shouldContain "키-1"
        }
    }

    /**
     * **경고는 '모르는 종류'만 센다.** 재료가 빈 예약도 보내는 목록에서는 빠지지만 그 사유는 위의 INFO 가 말한다 —
     * 둘을 한 경고로 세면 "계약 enum 밖"이라는 거짓 경고가 재료 없는 여행마다 뜬다(운영 48시간 51건이 그랬다).
     */
    "재료가 빈 예약은 '모르는 알림 종류' 경고를 내지 않고, 모르는 종류만 센다" {
        val starved = ReminderCopyRequest("키-s", NotificationKind.TRIP_DAY, LocalDate.parse("2026-08-10"))
        val other = NotificationKind.entries.first { it.name !in HttpReminderCopyAdapter.aiKinds() }
        val unknown = ReminderCopyRequest("키-u", other, LocalDate.parse("2026-08-10"), listOf(ReminderSlot("우도")))

        warnsFrom { it.copiesFor(null, listOf(starved)) }.none { "모르는 알림 종류" in it } shouldBe true

        // 둘이 섞여도 한 건(모르는 종류)만 센다 — 재료 빈 예약은 세지 않는다.
        warnsFrom { it.copiesFor(null, listOf(starved, unknown)) }
            .single { "모르는 알림 종류" in it } shouldContain "1건"
    }

    /**
     * **작게 쪼개 보낸다.** 계약 `maxItems: 30` 은 넘기면 한 건도 못 받는 하드 한계지만, 그보다 훨씬 전에 상대의 항목당 예산(마감 ÷
     * 항목 수)이 학생 모델의 지연보다 짧아진다 — 그래서 상한이 아니라 "마감 안에 끝낼 크기"(`chunkSize`)로 나눈다. 31건이면 3건씩 11번이다.
     */
    "묶음을 작게 쪼개 보낸다 — 상한(30)이 아니라 마감 안에 끝낼 크기로" {
        val many = (1..31).map {
            ReminderCopyRequest("키-$it", NotificationKind.TRIP_DAY, LocalDate.parse("2026-08-10"), listOf(ReminderSlot("곳-$it")))
        }
        withCapturingServer(body()) { url, sent ->
            adapterAt(url).copiesFor(null, many)

            val sizes = sent.map { Regex("\"schedule_key\"").findAll(it).count() }
            sizes shouldBe List(10) { ReminderCopyProperties().chunkSize } + 1
            // 쪼갠 크기는 늘 계약 상한 안이다 — 계약 게이트가 대조하는 값(`maxItems()`)이 실제 한계여야 한다.
            (sizes.max() <= HttpReminderCopyAdapter.maxItems()) shouldBe true
        }
    }

    /**
     * **한 번의 적재가 상대를 오래 붙들지 않는다.** 적재는 릴레이 스레드·DB 트랜잭션 안에서 도므로, 시간 예산을 넘기면 남은 묶음은
     * 건너뛴다 — 첫 묶음은 늘 보낸다. 건너뛴 행은 제자리 채우기가 나중에 메운다.
     */
    "시간 예산을 넘기면 남은 묶음은 건너뛴다 — 첫 묶음은 늘 보낸다" {
        val seven = (1..7).map {
            ReminderCopyRequest("키-$it", NotificationKind.TRIP_DAY, LocalDate.parse("2026-08-10"), listOf(ReminderSlot("곳-$it")))
        }
        withCapturingServer(body()) { url, sent ->
            adapterAt(url, ReminderCopyProperties(mode = "http", baseUrl = url, totalBudgetMs = 0)).copiesFor(null, seven)

            sent.size shouldBe 1
        }
    }

    /**
     * **요청 메타가 실린다.** 상대는 `deadline_ms` 로 자기 마감을 정한다 — 빠지거나 0 이면 상대가 곧바로
     * 시간 초과로 규칙 문구에 내려가고, 우리는 그것을 degraded 로 받아 늘 상수 문구가 된다.
     */
    "요청 메타에 요청 id·요청 시각·설정한 마감을, 항목에 종류·날짜를 싣는다" {
        withCapturingServer(body()) { url, sent ->
            adapterAt(url, ReminderCopyProperties(mode = "http", baseUrl = url, deadlineMs = 6_000)).copiesFor(null, items)

            val sentTree = ReminderCopyConfiguration.boundaryMapper().readTree(sent.single())
            val meta = sentTree["request_meta"]
            val requestId = meta["request_id"].asString()
            java.util.UUID.fromString(requestId).toString() shouldBe requestId // 정규 UUID 표기 그대로다
            Instant.parse(meta["requested_at"].asString()) shouldBe Instant.parse("2026-08-01T00:00:00Z")
            meta["deadline_ms"].asLong() shouldBe 6_000L
            // 상대는 종류로 말투를, 날짜로 "오늘/내일"을 정한다 — 비면 422 거나 엉뚱한 날 이야기다.
            sentTree["items"].map { it["kind"].asString() to it["date"].asString() } shouldBe
                listOf("TRIP_DAY" to "2026-08-10", "TRIP_PRE" to "2026-08-09")
        }
    }

    /** 컬럼 폭 경계는 **들어간다** — 60자 제목·200자 본문을 버리면 멀쩡한 AI 문구가 상수 문구로 떨어진다. */
    "컬럼 폭과 같은 길이의 문구는 받고, 본문이 한 자라도 넘치면 버린다" {
        val title = "가".repeat(60)
        val fits = "나".repeat(200)
        withServer(body(copies = """{"schedule_key":"키-1","title":"$title","body":"$fits"},{"schedule_key":"키-2","title":"제목","body":"${fits}다"}""")) { url ->
            val out = adapterAt(url).copiesFor(null, items)

            out.keys shouldBe setOf("키-1")
            out["키-1"] shouldBe ReminderCopy(title, fits)
        }
    }

    /** 읽기 타임아웃이 상대 백스톱(마감 + 5초)보다 짧으면, 상대가 정리해 보내는 응답을 우리가 먼저 끊는다. */
    "읽기 타임아웃은 마감+5초 이상이어야 한다 — 같은 값은 허용 경계다" {
        ReminderCopyProperties(deadlineMs = 8_000, readTimeoutMs = 13_000).readTimeoutMs shouldBe 13_000
        io.kotest.assertions.throwables.shouldThrow<IllegalArgumentException> {
            ReminderCopyProperties(deadlineMs = 8_000, readTimeoutMs = 12_999)
        }
    }
})

/** 어댑터 로거의 WARN 줄을 모은다. 보낼 항목이 없는 입력으로만 쓴다 — 호출이 나가지 않아 주소는 아무 값이어도 된다. */
private fun warnsFrom(block: (HttpReminderCopyAdapter) -> Unit): List<String> {
    val appender = ListAppender<ILoggingEvent>().apply { start() }
    val logger = LoggerFactory.getLogger(HttpReminderCopyAdapter::class.java) as Logger
    logger.addAppender(appender)
    try {
        block(adapterAt("http://127.0.0.1:1"))
    } finally {
        logger.detachAppender(appender)
    }
    return appender.list.filter { it.level == Level.WARN }.map { it.formattedMessage }
}

private fun body(copies: String = "", degraded: Boolean = false) =
    """{"copies":[$copies],"degraded":$degraded,"fallback_mode":null}"""

private fun adapterAt(
    baseUrl: String,
    properties: ReminderCopyProperties = ReminderCopyProperties(mode = "http", baseUrl = baseUrl),
) = HttpReminderCopyAdapter(
    RestClient.builder().baseUrl(baseUrl)
        .requestFactory(
            SimpleClientHttpRequestFactory().apply {
                setConnectTimeout(Duration.ofSeconds(2)); setReadTimeout(Duration.ofSeconds(3))
            },
        )
        .messageConverters {
            it.add(0, JacksonJsonHttpMessageConverter(ReminderCopyConfiguration.boundaryMapper()))
        }
        .build(),
    properties,
    Clock.fixed(Instant.parse("2026-08-01T00:00:00Z"), ZoneOffset.UTC),
)

/** [json] 이 null 이면 500 을 돌려준다 — 상대 장애를 흉내 낸다. */
private fun withServer(json: String?, onHit: () -> Unit = {}, block: (baseUrl: String) -> Unit) {
    val server = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0)
    server.createContext("/ai/v1/notification/copies") { ex ->
        onHit()
        if (json == null) {
            ex.sendResponseHeaders(500, -1)
        } else {
            val bytes = json.toByteArray()
            ex.responseHeaders.add("Content-Type", "application/json")
            ex.sendResponseHeaders(200, bytes.size.toLong())
            ex.responseBody.use { it.write(bytes) }
        }
        ex.close()
    }
    server.start()
    try {
        block("http://127.0.0.1:${server.address.port}")
    } finally {
        server.stop(0)
    }
}

/** 받은 요청 본문을 모은다 — 무엇을 **실제로 보냈는지**는 응답이 아니라 요청을 봐야 안다. */
private fun withCapturingServer(
    json: String,
    onHit: () -> Unit = {},
    block: (baseUrl: String, sent: List<String>) -> Unit,
) {
    val sent = mutableListOf<String>()
    val server = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0)
    server.createContext("/ai/v1/notification/copies") { ex ->
        onHit()
        sent += ex.requestBody.readBytes().decodeToString()
        val bytes = json.toByteArray()
        ex.responseHeaders.add("Content-Type", "application/json")
        ex.sendResponseHeaders(200, bytes.size.toLong())
        ex.responseBody.use { it.write(bytes) }
        ex.close()
    }
    server.start()
    try {
        block("http://127.0.0.1:${server.address.port}", sent)
    } finally {
        server.stop(0)
    }
}
