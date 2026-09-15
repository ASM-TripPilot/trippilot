package com.trippilot.weathercontext.adapter.out.external

import com.trippilot.placedata.api.RegionCenter
import com.trippilot.placedata.api.RegionLookupFacade
import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.ints.shouldBeInRange
import org.springframework.http.client.SimpleClientHttpRequestFactory
import org.springframework.web.client.RestClient
import java.time.Duration
import java.time.Instant

/**
 * **실 기상청 왕복** — 우리 어댑터가 실물에 대해 실제로 동작하는지.
 *
 * 평소에는 꺼져 있다. CI 게이트 정책이 "외부 API 호출 0회"라 상시 켜면 그 정책이 깨지고,
 * 키가 없는 환경에서는 무조건 빨개진다.
 *
 * 켜는 법:
 * ```
 * LIVE_KMA=1 WEATHER_API=<디코딩 키> ./gradlew :modules:weather-context:test --tests "*LiveKmaWeatherIT*"
 * ```
 *
 * **여기서만 드러나는 것**: 표본 응답은 우리가 만든 것이라 늘 우리 파서에 맞는다. 상대가 실제로
 * 그 모양을 주는지(빈 목록일 때 `items` 가 객체가 아니라 빈 문자열로 오는 변주 등)는 실호출로만
 * 알 수 있다. 그리고 **키가 인코딩 표기면 여기서 403 으로 걸린다** — 그 실수를 실제로 겪었다.
 */
class LiveKmaWeatherIT : StringSpec({

    val key = System.getenv("WEATHER_API").orEmpty()
    val enabled = System.getenv("LIVE_KMA") == "1" && key.isNotBlank()

    "실 기상청에서 제주 강수확률을 받는다".config(enabled = enabled) {
        val regions = object : RegionLookupFacade {
            override fun codesOf(regionName: String) = emptyList<String>()
            override fun isSelectableCode(regionCode: String) = false
            override fun centerOf(regionName: String) = RegionCenter(33.4996, 126.5312)
        }
        val props = KmaWeatherProperties(mode = "kma", serviceKey = key)
        val client = RestClient.builder().baseUrl(props.baseUrl)
            .requestFactory(
                SimpleClientHttpRequestFactory().apply {
                    setConnectTimeout(Duration.ofSeconds(3)); setReadTimeout(Duration.ofSeconds(10))
                },
            ).build()

        val snap = KmaWeatherAdapter(regions, client, props).fetch("제주", Instant.now())

        // 값 자체는 날씨라 단정하지 않는다 — **받아서 범위 안이면** 계약이 맞은 것이다.
        snap.precipProbability shouldBeInRange 0..100
        println("[LIVE-KMA] 제주 강수확률=${snap.precipProbability}% 발표=${snap.baseAt} 만료=${snap.expiresAt}")
    }
})
