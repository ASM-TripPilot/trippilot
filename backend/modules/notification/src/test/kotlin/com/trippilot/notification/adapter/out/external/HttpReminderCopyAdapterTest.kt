package com.trippilot.notification.adapter.out.external

import com.sun.net.httpserver.HttpServer
import com.trippilot.notification.domain.NotificationKind
import com.trippilot.notification.domain.ReminderCopyRequest
import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.maps.shouldBeEmpty
import io.kotest.matchers.shouldBe
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

    val items = listOf(
        ReminderCopyRequest("키-1", NotificationKind.TRIP_DAY, LocalDate.parse("2026-08-10")),
        ReminderCopyRequest("키-2", NotificationKind.TRIP_PRE, LocalDate.parse("2026-08-09")),
    )

    "정상 응답의 문구를 키로 맞춰 돌려준다" {
        withServer(body(copies = """{"schedule_key":"키-1","title":"제목","body":"본문"}""")) { url ->
            val out = adapterAt(url).copiesFor("제주 여행", items)

            out.keys shouldBe setOf("키-1")
            out["키-1"]!!.title shouldBe "제목"
        }
    }

    /**
     * **`degraded` 면 하나도 안 쓴다.** 상대가 규칙 문구로 내려간 것이라 우리 상수 문구와 다를 바
     * 없는데, 저장하면 품질 관측이 거짓이 된다(회고 `source` 선례).
     */
    "degraded 응답은 문구가 와도 버린다" {
        val b = """{"copies":[{"schedule_key":"키-1","title":"제목","body":"본문"}],
            "degraded":true,"fallback_mode":"rule"}"""
        withServer(b) { url ->
            adapterAt(url).copiesFor(null, items).shouldBeEmpty()
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
})

private fun body(copies: String = "", degraded: Boolean = false) =
    """{"copies":[$copies],"degraded":$degraded,"fallback_mode":null}"""

private fun adapterAt(baseUrl: String) = HttpReminderCopyAdapter(
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
    ReminderCopyProperties(mode = "http", baseUrl = baseUrl),
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
