package com.trippilot.weathercontext.adapter.out.external

import com.trippilot.weathercontext.domain.WeatherGatewayRefused
import com.trippilot.weathercontext.domain.WeatherLookupFailed
import org.slf4j.Logger
import org.springframework.web.client.RestClient
import java.net.URI
import java.nio.charset.StandardCharsets
import java.util.concurrent.atomic.AtomicReference

/**
 * 공공데이터포털 GET 한 건과 그 출처의 상태 — 특보·대기질 어댑터가 함께 쓴다(RES-SA-02 · OBS-SA-03).
 *
 * - 질의는 호출측이 조립해 [URI] 로 넘긴다 — 키는 `URLEncoder` 로 인코딩해야 한다(`+` 를 그대로 두면 서버가 공백으로 읽어 403).
 * - 게이트웨이 거절([PublicDataGatewayError] — JSON 을 요청해도 XML 본문으로 온다)은 [WeatherGatewayRefused], 그 밖의 HTTP 오류·
 *   연결 실패·시한은 [WeatherLookupFailed] 다. 둘 다 재요청하지 않는다(다음 회차에 다시 묻는다).
 * - WARN 은 **상태가 바뀔 때만** 한 번 — 같은 원인이 이어지는 동안 반복하지 않고, 풀리면 INFO 한 줄이다. 원인 코드만 싣는다.
 * - 예외·로그에 요청 주소·본문을 싣지 않고 원인 예외도 매달지 않는다 — 질의 문자열에 서비스 키가 있다(SEC-SA-03).
 */
internal class PublicDataCall(private val client: RestClient, private val source: String, private val log: Logger) {

    /** 마지막 실패 원인 — null 이면 통과 중. 파드 범위다. */
    private val state = AtomicReference<String?>(null)

    /** 2xx 이고 게이트웨이 거절이 아닌 본문. */
    fun get(uri: URI): String {
        val (status, body) = try {
            client.get().uri(uri).exchangeForRequiredValue { _, res ->
                res.statusCode.value() to String(res.body.readAllBytes(), StandardCharsets.UTF_8)
            }
        } catch (e: Exception) {
            fail("연결 실패 ${e.javaClass.simpleName}")
        }
        PublicDataGatewayError.reasonOf(status, body)?.let { refuse(it) }
        if (status !in 200..299) fail("HTTP $status")
        return body
    }

    /** 게이트웨이 거절 — 그 출처 전체의 모름. */
    fun refuse(code: String): Nothing {
        if (state.getAndSet("gateway:$code") != "gateway:$code") {
            log.warn("{} — 공공데이터포털 게이트웨이가 거절했습니다(원인 코드 {}). 그 출처를 모름으로 두고 다음 회차에 다시 묻습니다.", source, code)
        }
        throw WeatherGatewayRefused(code)
    }

    /** 장애·형식 깨짐 — [why] 는 원인 이름(주소·본문·키 없음). */
    fun fail(why: String): Nothing {
        if (state.getAndSet(why) != why) {
            log.warn("{} — 조회하지 못했습니다({}). 그 출처를 모름으로 두고 다음 회차에 다시 묻습니다.", source, why)
        }
        throw WeatherLookupFailed("$source 조회 실패($why)")
    }

    /** 정상 응답을 읽었다 — 막혀 있었으면 풀렸다고 한 줄 남긴다. */
    fun passed() {
        val was = state.getAndSet(null) ?: return
        log.info("{} — 다시 조회됩니다(직전 원인 {}).", source, was)
    }
}
