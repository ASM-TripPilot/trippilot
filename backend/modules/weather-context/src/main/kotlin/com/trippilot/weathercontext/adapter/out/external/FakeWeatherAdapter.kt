package com.trippilot.weathercontext.adapter.out.external

import com.trippilot.weathercontext.domain.WeatherPort
import com.trippilot.weathercontext.domain.WeatherSnapshot
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty
import org.springframework.stereotype.Component
import java.time.Duration
import java.time.Instant
import java.time.temporal.ChronoUnit

/**
 * 기상 조회 Fake(계약-우선). 실 벤더 어댑터(`KmaWeatherAdapter`)는 **공공데이터포털 API 키 발급 후**라
 * 정본도 "개발 중 처리"로 이연했다(LC-U4-3 선결).
 *
 * 값을 **결정론적으로** 만든다 — 격자 키 해시로 강수확률을 고정한다. 무작위면 같은 입력에 다른 판정이 나와
 * 테스트가 흔들리고, 통합 시 "왜 이 알림이 떴나"를 되짚을 수 없다.
 *
 * 발표 주기(3시간)를 그대로 흉내 내 캐시 키가 실제와 같은 모양이 되게 한다(P-PERF-U4-1).
 */
@Component
@ConditionalOnProperty(name = ["trippilot.weather.mode"], havingValue = "fake", matchIfMissing = true)
class FakeWeatherAdapter : WeatherPort {

    override fun fetch(gridKey: String, at: Instant): WeatherSnapshot {
        val baseAt = at.truncatedTo(ChronoUnit.HOURS)
            .minus(Duration.ofHours((at.atZone(java.time.ZoneOffset.UTC).hour % PUBLISH_INTERVAL_HOURS).toLong()))
        return WeatherSnapshot(
            gridKey = gridKey,
            baseAt = baseAt,
            precipProbability = Math.floorMod(gridKey.hashCode(), 101),
            warning = null,
            fetchedAt = at,
            expiresAt = baseAt.plus(Duration.ofHours(PUBLISH_INTERVAL_HOURS.toLong())),
        )
    }

    private companion object {
        /** 기상청 단기예보 발표 간격. TTL 을 임의로 정하지 않고 **다음 발표까지**로 둔다. */
        private const val PUBLISH_INTERVAL_HOURS = 3
    }
}
