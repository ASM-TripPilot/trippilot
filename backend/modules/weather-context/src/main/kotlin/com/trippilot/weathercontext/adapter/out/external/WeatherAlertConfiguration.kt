package com.trippilot.weathercontext.adapter.out.external

import org.slf4j.LoggerFactory
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty
import org.springframework.boot.context.properties.EnableConfigurationProperties
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Configuration
import org.springframework.http.client.SimpleClientHttpRequestFactory
import org.springframework.web.client.RestClient
import java.time.Duration

/**
 * 기상특보·대기질 어댑터 조립(situation-awareness 설계서 §4.2 · tech-stack 델타 5) — **실 기상청 모드(`WEATHER_MODE=kma`)에서만**
 * 설정 클래스째 뜬다(가짜 날씨면 빈이 없어 감지기가 live 가 아니다 — 호출 0). 조건을 빈 하나가 아니라 클래스에 건다(anti-patterns).
 *
 * **키** = `PUBLIC_DATA_API_KEY`(특보·대기질 활용신청 계정 — 2026-10-19 실측 통과), 비면 `WEATHER_API`. compose 는 설정하지 않은 env 를
 * 빈 문자열로 넘기므로 yml 중첩 기본값(`${'$'}{PUBLIC_DATA_API_KEY:${'$'}{WEATHER_API:}}`)으로는 대신이 안 된다 — 여기서 빈 값을 본다.
 * 기동 줄에는 키를 읽은 env **이름만** 남긴다(값은 싣지 않는다 — SEC-SA-03). `WEATHER_API` 키 없이 kma 면 [KmaWeatherConfiguration] 이
 * 이미 기동을 막는다 — 같은 검사를 여기 다시 두지 않는다.
 *
 * 시한은 단기예보와 같은 connect 3s · read 5s 다(PERF-SA-04). 클라이언트는 어댑터마다 새로 만든다(공유 빌더 변형 금지 — anti-patterns).
 */
@Configuration
@ConditionalOnProperty(name = ["trippilot.weather.mode"], havingValue = "kma")
@EnableConfigurationProperties(KmaWeatherProperties::class)
class WeatherAlertConfiguration(private val properties: KmaWeatherProperties) {

    private val key: String = properties.publicDataKey.ifBlank { properties.serviceKey }

    init {
        val source = if (properties.publicDataKey.isNotBlank()) "PUBLIC_DATA_API_KEY" else "WEATHER_API(PUBLIC_DATA_API_KEY 비어 대체)"
        log.info("기상특보·대기질 조회 = 실 공공데이터포털 · 키={}", source)
        // 인코딩 키는 질의에서 한 번 더 인코딩돼(%252B) 매 회차 게이트웨이 거절(403·30)이고 원인이 안 보인다 — 기동에서 한 번 짚는다.
        // WEATHER_API 쪽은 KmaWeatherConfiguration 이 같은 검사를 한다.
        if ('%' in properties.publicDataKey) {
            log.warn(
                "PUBLIC_DATA_API_KEY 에 '%' 가 있습니다 — **인코딩 키**로 보입니다. 한 번 더 인코딩돼 기상특보·대기질 조회가 게이트웨이 거절(403·30)로 " +
                    "끝납니다. 포털의 **일반 인증키(Decoding)** 를 넣으십시오.",
            )
        }
    }

    @Bean
    fun kmaWarningAdapter(): KmaWarningAdapter = KmaWarningAdapter(client(), properties.warningBaseUrl, key)

    @Bean
    fun airKoreaAdapter(): AirKoreaAdapter = AirKoreaAdapter(client(), properties.airBaseUrl, key)

    private fun client(): RestClient = RestClient.builder()
        .requestFactory(
            SimpleClientHttpRequestFactory().apply {
                setConnectTimeout(Duration.ofMillis(properties.connectTimeoutMs))
                setReadTimeout(Duration.ofMillis(properties.readTimeoutMs))
            },
        )
        .build()

    private companion object {
        private val log = LoggerFactory.getLogger(WeatherAlertConfiguration::class.java)
    }
}
