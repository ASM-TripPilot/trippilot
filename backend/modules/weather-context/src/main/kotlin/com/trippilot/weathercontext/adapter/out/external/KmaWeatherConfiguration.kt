package com.trippilot.weathercontext.adapter.out.external

import com.trippilot.placedata.api.RegionLookupFacade
import com.trippilot.weathercontext.domain.WeatherPort
import org.slf4j.LoggerFactory
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty
import org.springframework.boot.context.properties.ConfigurationProperties
import org.springframework.boot.context.properties.EnableConfigurationProperties
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Configuration
import org.springframework.http.client.SimpleClientHttpRequestFactory
import org.springframework.web.client.RestClient
import java.time.Duration

/**
 * 기상 조회 경계 설정(TRIP-849).
 *
 * [mode]=`fake`(기본)면 [FakeWeatherAdapter], `kma` 면 실 어댑터. 기본이 가짜인 이유는 로컬·CI 가
 * 외부 키에 묶이지 않아야 하기 때문이다(CI 정책: 외부 API 호출 0회).
 *
 * [serviceKey] 는 **디코딩 키**다. 인코딩 키(`%2B`·`%3D` 포함)를 넣으면 HTTP 클라이언트가 한 번 더
 * 인코딩해 `%252B` 가 되고 서버가 **403** 으로 거절한다 — 실측으로 겪었고(2026-09-15~16),
 * 그때 증상이 "키가 잘못됐다"로 보여 멀쩡한 키를 재발급하러 갈 뻔했다.
 */
@ConfigurationProperties(prefix = "trippilot.weather")
data class KmaWeatherProperties(
    val mode: String = "fake",
    val baseUrl: String = "https://apis.data.go.kr/1360000/VilageFcstInfoService_2.0",
    /** 공공데이터포털 일반 인증키 **(Decoding)**. `%` 가 들어 있으면 인코딩 키다. */
    val serviceKey: String = "",
    val connectTimeoutMs: Long = 3_000,
    /** 감지는 배경 작업이라 길게 기다릴 이유가 없다 — 실패는 무발화로 간다(BR-U4-05). */
    val readTimeoutMs: Long = 5_000,
)

@Configuration
@EnableConfigurationProperties(KmaWeatherProperties::class)
class KmaWeatherConfiguration {

    @Bean
    @ConditionalOnProperty(name = ["trippilot.weather.mode"], havingValue = "kma")
    fun kmaWeatherAdapter(regions: RegionLookupFacade, properties: KmaWeatherProperties): WeatherPort {
        // 키 없이 kma 로 켜면 **모든 조회가 403 으로 실패하고 Plan-B 가 통째로 무발화**가 된다.
        // 조용히 그렇게 도는 것보다 기동을 막는 편이 낫다(RegionGeocodeModeAnnouncer 선례).
        check(properties.serviceKey.isNotBlank()) {
            "trippilot.weather.mode=kma 인데 기상청 인증키(WEATHER_API)가 비어 있습니다. " +
                "이대로 기동하면 모든 날씨 조회가 실패해 Plan-B 우천 트리거가 영영 발화하지 않습니다. " +
                "키를 주입하거나, 가짜로 돌리려면 mode 를 kma 가 아닌 값으로 두십시오."
        }
        // 인코딩 키를 넣는 실수는 403 으로만 드러나고 원인이 안 보인다 — 기동에서 한 번 짚어 준다.
        if (properties.serviceKey.contains('%')) {
            log.warn(
                "기상청 인증키에 '%' 가 있습니다 — **인코딩 키**로 보입니다. 클라이언트가 한 번 더 " +
                    "인코딩해 403 이 납니다. 포털의 **일반 인증키(Decoding)** 를 넣으십시오.",
            )
        }
        log.info("기상 조회 = 실 기상청(kma) · baseUrl={}", properties.baseUrl)
        return KmaWeatherAdapter(regions, client(properties), properties)
    }

    private fun client(properties: KmaWeatherProperties): RestClient =
        RestClient.builder()
            .baseUrl(properties.baseUrl)
            .requestFactory(
                SimpleClientHttpRequestFactory().apply {
                    setConnectTimeout(Duration.ofMillis(properties.connectTimeoutMs))
                    setReadTimeout(Duration.ofMillis(properties.readTimeoutMs))
                },
            )
            .build()

    private companion object {
        private val log = LoggerFactory.getLogger(KmaWeatherConfiguration::class.java)
    }
}
