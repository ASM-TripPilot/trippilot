package com.trippilot.weathercontext.adapter.out.external

import com.trippilot.weathercontext.domain.WeatherPort
import jakarta.annotation.PostConstruct
import org.slf4j.LoggerFactory
import org.springframework.beans.factory.annotation.Value
import org.springframework.stereotype.Component

/**
 * 기동 시 **어느 날씨 경계가 살아 있는지**를 알린다(`RegionGeocodeModeAnnouncer` 선례).
 *
 * 스위치가 안 걸려도 앱은 기본값(가짜)으로 정상 기동한다. 그 침묵을 깨지 않으면 Plan-B 우천
 * 트리거가 **지어낸 강수확률로 도는지 실 기상청으로 도는지** 로그로 구분할 수 없다 — 그리고
 * 가짜 쪽은 비가 안 와도 트리거가 돌 수 있어, 조용하면 "원래 그런가 보다"로 읽힌다.
 *
 * 판정은 설정값이 아니라 **실제 주입된 구현**으로 한다 — 설정과 결과가 어긋나는 경우가 문제라서다.
 *
 * **키 가드는 여기 없다.** `KmaWeatherConfiguration` 이 빈을 만들 때 이미 막는다 — 키 없이
 * `mode=kma` 면 그쪽에서 기동이 실패하므로 여기까지 오지 않는다. 같은 검사를 두 곳에 두면
 * 한쪽을 고칠 때 다른 쪽이 남아 규칙이 갈린다.
 */
@Component
class WeatherModeAnnouncer(
    private val port: WeatherPort,
    @param:Value("\${trippilot.weather.mode:fake}") private val mode: String,
) {

    @PostConstruct
    fun announce() {
        val live = port.javaClass.simpleName
        if (port is FakeWeatherAdapter) {
            log.info("날씨 조회 = 가짜 강수확률 · 구현={} — Plan-B 우천 트리거가 실제 날씨와 무관하게 돈다", live)
        } else {
            log.info("날씨 조회 = 실 기상청(KMA) · 구현={}", live)
        }
        // 아는 값이 아니면 조건부 빈이 안 걸려 가짜로 남는다 — 설정 의도와 결과가 다르다는 뜻이라 경고로 올린다.
        if (!mode.equals("fake", ignoreCase = true) && !mode.equals("kma", ignoreCase = true)) {
            log.warn("trippilot.weather.mode='{}' 는 아는 값이 아닙니다(fake|kma) — 가짜 날씨로 동작합니다.", mode)
        }
    }

    private companion object {
        private val log = LoggerFactory.getLogger(WeatherModeAnnouncer::class.java)
    }
}
