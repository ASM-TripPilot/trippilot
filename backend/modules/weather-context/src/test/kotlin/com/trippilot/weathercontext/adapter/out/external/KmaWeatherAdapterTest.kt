package com.trippilot.weathercontext.adapter.out.external

import com.sun.net.httpserver.HttpServer
import com.trippilot.placedata.api.RegionCenter
import com.trippilot.placedata.api.RegionLookupFacade
import com.trippilot.weathercontext.domain.WeatherLookupFailed
import io.kotest.assertions.throwables.shouldThrow
import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.shouldBe
import io.kotest.matchers.string.shouldContain
import org.springframework.http.client.SimpleClientHttpRequestFactory
import org.springframework.web.client.RestClient
import java.net.InetSocketAddress
import java.time.Duration
import java.time.Instant
import java.time.ZoneId

/**
 * 기상청 실 어댑터(TRIP-849).
 *
 * **실 소켓으로 잰다.** `MockRestServiceServer` 는 빌더에 붙어야 하는데 설정이 완성된 클라이언트만
 * 돌려주고, 무엇보다 **상대가 실제로 받은 질의 문자열**(격자·발표시각)을 봐야 한다 — 그게 이
 * 어댑터가 하는 일의 절반이다.
 *
 * 응답 표본은 기상청 활용가이드의 형태를 따르되 **실측 변주**를 반영했다: `fcstValue` 가
 * 문자열로 온다.
 */
class KmaWeatherAdapterTest : StringSpec({

    val jeju = object : RegionLookupFacade {
        override fun codesOf(regionName: String) = emptyList<String>()
        override fun isSelectableCode(regionCode: String) = false
        override fun centerOf(regionName: String) =
            if (regionName == "제주") RegionCenter(33.4996, 126.5312) else null
        /** 코드 중심 — 이 대역은 이름 경로만 쓴다(TRIP-859 후속이 인터페이스에 더한 메서드). */
        override fun centerOfCode(regionCode: String) = null
    }

    "정상 응답에서 그 날짜 강수확률의 **최댓값**을 뽑는다" {
        withServer(okBody(listOf("20260916" to "20", "20260916" to "70", "20260916" to "10"))) { url, _ ->
            val snap = adapterAt(url, jeju).fetch("제주", AT)

            // 평균(33)이나 첫 값(20)이 아니라 최댓값 — 오후에만 쏟아지는 날이 묻히면 안 된다.
            snap.precipProbability shouldBe 70
            snap.gridKey shouldBe "제주"
        }
    }

    /**
     * **다른 날짜로 대체하지 않는다.** 내일 예보로 오늘을 판단하면 틀린 근거로 개입하게 된다
     * (BR-U4-05 허위 알림 금지). 없으면 실패이고, 실패는 무발화로 간다.
     */
    "요청한 날짜가 응답에 없으면 실패다 — 다음 날 값을 대신 쓰지 않는다" {
        withServer(okBody(listOf("20260917" to "90"))) { url, _ ->
            shouldThrow<WeatherLookupFailed> { adapterAt(url, jeju).fetch("제주", AT) }
        }
    }

    "좌표를 모르는 지역은 부르기 전에 실패한다 — 헛된 호출을 아낀다" {
        withServer(okBody(listOf("20260916" to "20"))) { url, hits ->
            shouldThrow<WeatherLookupFailed> { adapterAt(url, jeju).fetch("모르는곳", AT) }
            hits.size shouldBe 0
        }
    }

    "정상 코드가 아니면 실패다 — 200 이어도 본문이 거절일 수 있다" {
        withServer("""{"response":{"header":{"resultCode":"03","resultMsg":"NODATA_ERROR"}}}""") { url, _ ->
            shouldThrow<WeatherLookupFailed> { adapterAt(url, jeju).fetch("제주", AT) }
                .message!! shouldContain "03"
        }
    }

    /**
     * 격자와 발표시각이 **질의에 실제로 실리는지**. 값을 안 실어도 상대는 200 을 주므로
     * (기본 격자로 답한다) 응답만 보면 이 실수가 안 드러난다.
     */
    "질의에 제주 격자와 최근 발표시각이 실린다" {
        withServer(okBody(listOf("20260916" to "20"))) { url, hits ->
            adapterAt(url, jeju).fetch("제주", AT)

            val q = hits.single()
            q shouldContain "nx=53"
            q shouldContain "ny=38"
            // KST 09:30 → 제공 지연 10분을 빼면 09:20 → 그 이전 발표는 08시.
            q shouldContain "base_time=0800"
            q shouldContain "base_date=20260916"
        }
    }

    /**
     * **인증키의 `+` 가 `%2B` 로 실려야 한다.**
     *
     * 실 왕복에서 403 을 만든 자리다(2026-09-16). `UriBuilder.queryParam` 에 키를 맡기면 `+` 가
     * 그대로 남고(RFC 3986 상 질의에서 합법), 서버는 그것을 **공백으로 해석**해 키가 깨진다.
     *
     * **가짜 서버는 키를 검증하지 않으므로 다른 모든 테스트는 이 실수를 원리적으로 못 본다** —
     * 실 왕복은 평소 꺼져 있으니(CI 외부 호출 0회) 되돌아가도 아무것도 안 빨개진다. 질의 문자열을
     * 직접 보는 이 단언이 유일한 그물이다.
     */
    "인증키의 + 가 %2B 로 인코딩돼 실린다 — 공백으로 읽히면 403 이다" {
        val keyed = { url: String ->
            KmaWeatherAdapter(
                jeju,
                RestClient.builder().baseUrl(url)
                    .requestFactory(
                        SimpleClientHttpRequestFactory().apply {
                            setConnectTimeout(Duration.ofSeconds(2)); setReadTimeout(Duration.ofSeconds(2))
                        },
                    ).build(),
                KmaWeatherProperties(mode = "kma", baseUrl = url, serviceKey = "aB+cd/ef=="),
            )
        }
        withServer(okBody(listOf("20260916" to "20"))) { url, hits ->
            keyed(url).fetch("제주", AT)

            val q = hits.single()
            q shouldContain "serviceKey=aB%2Bcd%2Fef%3D%3D"
            // 날것으로 실리면 서버가 '+' 를 공백으로 읽는다 — 그 상태를 이름으로 못 박는다.
            q.contains("serviceKey=aB+cd") shouldBe false
        }
    }

    /**
     * 발표 직후(제공 지연 안)는 **이전 발표분**을 요청해야 한다. 안 빼면 방금 발표된 시각을
     * 물어 빈 응답을 받고, 그 실패는 "날씨를 못 봤다"로만 보인다.
     */
    "발표 직후에는 이전 발표분을 요청한다" {
        withServer(okBody(listOf("20260916" to "20"))) { url, hits ->
            // KST 08:05 — 08시 발표는 아직 제공 전이다.
            adapterAt(url, jeju).fetch("제주", kst("2026-09-16T08:05:00"))

            hits.single() shouldContain "base_time=0500"
        }
    }

    /**
     * **발표 날짜와 묻는 날짜가 다른 경우.** 자정 직후에는 전날 23시 발표분을 받는데, 우리가 알고
     * 싶은 것은 **오늘** 강수확률이다. 발표 날짜로 거르면 오늘 값을 하나도 못 찾는다 —
     * 실 왕복에서 이 실수가 드러났다(2026-09-16). 표본 응답이 둘을 모두 담아야 구분된다.
     */
    "자정 직후에는 전날 발표분을 요청하되, 오늘 값을 고른다" {
        val body = okBody(listOf("20260915" to "10", "20260916" to "80"))
        withServer(body) { url, hits ->
            val snap = adapterAt(url, jeju).fetch("제주", kst("2026-09-16T00:30:00"))

            val q = hits.single()
            q shouldContain "base_time=2300"
            q shouldContain "base_date=20260915" // 발표는 어제 것
            snap.precipProbability shouldBe 80 // 그러나 값은 오늘 것
        }
    }
})

private val KST: ZoneId = ZoneId.of("Asia/Seoul")
private fun kst(local: String): Instant =
    java.time.LocalDateTime.parse(local).atZone(KST).toInstant()

/** KST 2026-09-16 09:30 — 08시 발표분이 최신인 시각. */
private val AT: Instant = kst("2026-09-16T09:30:00")

private fun adapterAt(baseUrl: String, regions: RegionLookupFacade) = KmaWeatherAdapter(
    regions,
    RestClient.builder().baseUrl(baseUrl)
        .requestFactory(
            SimpleClientHttpRequestFactory().apply {
                setConnectTimeout(Duration.ofSeconds(2)); setReadTimeout(Duration.ofSeconds(2))
            },
        ).build(),
    KmaWeatherProperties(mode = "kma", baseUrl = baseUrl, serviceKey = "테스트키"),
)

/** `fcstValue` 를 **문자열**로 담는다 — 실측 변주다. */
private fun okBody(pops: List<Pair<String, String>>): String {
    val items = pops.joinToString(",") { (date, v) ->
        """{"category":"POP","fcstDate":"$date","fcstTime":"1200","fcstValue":"$v","nx":53,"ny":38}"""
    }
    return """{"response":{"header":{"resultCode":"00","resultMsg":"NORMAL_SERVICE"},
        "body":{"items":{"item":[$items]}}}}"""
}

/** 받은 질의 문자열을 모은다 — 격자·발표시각이 실렸는지는 응답이 아니라 요청을 봐야 안다. */
private fun withServer(body: String, block: (baseUrl: String, queries: List<String>) -> Unit) {
    val queries = mutableListOf<String>()
    val server = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0)
    server.createContext("/getVilageFcst") { ex ->
        queries += ex.requestURI.rawQuery ?: ""
        val bytes = body.toByteArray()
        ex.responseHeaders.add("Content-Type", "application/json")
        ex.sendResponseHeaders(200, bytes.size.toLong())
        ex.responseBody.use { it.write(bytes) }
    }
    server.start()
    try {
        block("http://127.0.0.1:${server.address.port}", queries)
    } finally {
        server.stop(0)
    }
}
