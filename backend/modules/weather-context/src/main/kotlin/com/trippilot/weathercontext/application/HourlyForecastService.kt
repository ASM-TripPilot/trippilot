package com.trippilot.weathercontext.application

import com.trippilot.weathercontext.api.DailyWeather
import com.trippilot.weathercontext.api.HourlyForecastFacade
import com.trippilot.weathercontext.api.HourlyForecastUnavailable
import com.trippilot.weathercontext.api.HourlyWeather
import com.trippilot.weathercontext.api.PointForecast
import com.trippilot.weathercontext.api.Precipitation
import com.trippilot.weathercontext.api.Sky
import com.trippilot.weathercontext.domain.GridForecast
import com.trippilot.weathercontext.domain.GridForecastMissing
import com.trippilot.weathercontext.domain.GridForecastPort
import com.trippilot.weathercontext.domain.GridForecastRepository
import com.trippilot.weathercontext.domain.WeatherGatewayRefused
import com.trippilot.weathercontext.domain.WeatherLookupFailed
import org.slf4j.LoggerFactory
import org.springframework.beans.factory.ObjectProvider
import org.springframework.dao.DataIntegrityViolationException
import org.springframework.stereotype.Service
import java.time.Clock
import java.time.Instant

/**
 * 격자 시간별 예보 — 읽기-통과 캐시(weather_grid_forecast · domain-entities §8.1 · tech-stack 델타 3).
 *
 * 신선한 행이 있으면 그대로 쓰고, 없으면 원천을 한 번 불러 **정상만** 저장한다. 받아 온 값도 신선해야 쓴다 —
 * 이름 경로(`WeatherContextService`)는 저장 뒤 신선도를 다시 보지 않아 발표 직후 10분 동안 매 조회가 외부 호출이 됐다.
 *
 * **트랜잭션을 걸지 않는다** — HTTP 가 DB 연결을 쥐지 않게 한다. 캐시 읽기·쓰기는 저장소가 각자 짧게 연다.
 * 격자 포트는 실 기상청 모드에만 있다(가짜 날씨면 빈이 없다) — 그래서 live 판정을 설정값이 아니라 빈 유무로 한다.
 */
@Service
class HourlyForecastService(
    private val grids: ObjectProvider<GridForecastPort>,
    private val forecasts: GridForecastRepository,
    private val clock: Clock,
) : HourlyForecastFacade {

    override fun isLive(): Boolean = grids.getIfAvailable() != null

    override fun gridKeyOf(lat: Double, lng: Double): String? = grids.getIfAvailable()?.gridKeyOf(lat, lng)

    override fun forecastForTrigger(lat: Double, lng: Double, at: Instant): PointForecast? {
        val port = grids.getIfAvailable() ?: return null
        val gridKey = port.gridKeyOf(lat, lng)
        forecasts.find(gridKey)?.takeIf { it.isFreshAt(at) }?.let { return it.toPoint() }
        val fetched = try {
            // 발표분 선택은 실제 시각을 따른다 — 상대가 아직 안 낸 발표를 묻지 않게(이름 경로와 같다).
            port.fetchGrid(gridKey, clock.instant())
        } catch (e: GridForecastMissing) {
            log.debug("격자 예보 없음 — 그 격자는 모름입니다. grid={}", gridKey)
            return null
        } catch (e: WeatherGatewayRefused) {
            throw HourlyForecastUnavailable(gridKey, e.reasonCode)
        } catch (e: WeatherLookupFailed) {
            throw HourlyForecastUnavailable(gridKey, null)
        }
        if (!fetched.isFreshAt(at)) return null // 낡은 근거로 개입하지 않는다(INV-U4-09)
        try {
            forecasts.save(fetched)
        } catch (e: DataIntegrityViolationException) {
            // 같은 격자를 두 스레드가 처음으로 동시에 받았다 — 늦은 INSERT 만 키에 걸린다. 받은 값은 멀쩡하다.
            log.debug("격자 예보 동시 저장 — 먼저 저장된 행을 둡니다. grid={}", gridKey)
        }
        return fetched.toPoint()
    }

    private fun GridForecast.toPoint() = PointForecast(
        gridKey = gridKey,
        baseAt = baseAt,
        hourly = hourly.mapValues { (_, h) -> HourlyWeather(h.pop, precipitationOf(h.pty), skyOf(h.sky), h.tmp, h.wsd) },
        daily = daily.mapValues { (_, d) -> DailyWeather(d.tmn, d.tmx) },
    )

    private fun precipitationOf(code: Int?): Precipitation? = when (code) {
        0 -> Precipitation.NONE
        1 -> Precipitation.RAIN
        2 -> Precipitation.RAIN_SNOW
        3 -> Precipitation.SNOW
        4 -> Precipitation.SHOWER
        else -> null
    }

    private fun skyOf(code: Int?): Sky? = when (code) {
        1 -> Sky.CLEAR
        3 -> Sky.MOSTLY_CLOUDY
        4 -> Sky.OVERCAST
        else -> null
    }

    private companion object {
        private val log = LoggerFactory.getLogger(HourlyForecastService::class.java)
    }
}
