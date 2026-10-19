package com.trippilot.weathercontext.application

import com.trippilot.weathercontext.api.ActiveWarning
import com.trippilot.weathercontext.api.AirGrade
import com.trippilot.weathercontext.api.AirRegion
import com.trippilot.weathercontext.api.AlertRead
import com.trippilot.weathercontext.api.WeatherAlertFacade
import com.trippilot.weathercontext.domain.AirForecast
import com.trippilot.weathercontext.domain.AirForecastPort
import com.trippilot.weathercontext.domain.WarningStatusPort
import com.trippilot.weathercontext.domain.WeatherGatewayRefused
import com.trippilot.weathercontext.domain.WeatherLookupFailed
import org.springframework.beans.factory.ObjectProvider
import org.springframework.stereotype.Service
import java.time.Duration
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId

/**
 * 기상특보·대기질 읽기 — 파드 메모리 기억뿐이다(domain-entities §8.2 — 원문을 DB 에 남기지 않는다).
 *
 * - **특보 20분**(COST-SA-03 회차당 1콜). 같은 발표면 다시 파싱하지 않는 것은 어댑터 몫이다.
 * - **대기질 발표 단위**(COST-SA-04) — 받은 발표분의 다음 발표(+6시간: 05·11·17·23시) + 제공 지연 30분까지. 다음 발표가 늦어 옛
 *   발표분을 다시 받으면 20분은 그대로 둔다(회차 안 반복 호출 방지). 묻는 날짜(KST)가 바뀌면 기억을 쓰지 않는다.
 * - **실패는 기억하지 않는다**(게이트웨이 거절·장애 — COST-SA-05 다음 회차에 다시 묻는다). 한 회차 안의 반복 호출을 막는 것은
 *   감지기의 회차 기억이다.
 * - 처음 묻는 두 여행이 겹쳐도(여행 단위 병렬) 원천은 한 번만 부른다.
 *
 * live 는 설정값이 아니라 포트 빈 유무로 정한다 — 실 기상청 모드(`WEATHER_MODE=kma`)에만 빈이 있다.
 */
@Service
class WeatherAlertService(
    private val warningPorts: ObjectProvider<WarningStatusPort>,
    private val airPorts: ObjectProvider<AirForecastPort>,
) : WeatherAlertFacade {

    private val warningLock = Any()
    @Volatile private var warningMemo: Pair<List<ActiveWarning>, Instant>? = null

    private val airLock = Any()
    @Volatile private var airMemo: AirMemo? = null

    override fun isLive(): Boolean = warningPorts.getIfAvailable() != null && airPorts.getIfAvailable() != null

    override fun warnings(at: Instant): AlertRead<List<ActiveWarning>> {
        val port = warningPorts.getIfAvailable() ?: return AlertRead.Unknown(OFF)
        synchronized(warningLock) {
            warningMemo?.takeIf { at < it.second }?.let { return AlertRead.Ok(it.first) }
            val read = read { port.fetchWarnings() }
            if (read is AlertRead.Ok) warningMemo = read.value to at.plus(WARNING_HOLD)
            return read
        }
    }

    override fun airGrades(date: LocalDate, at: Instant): AlertRead<Map<AirRegion, AirGrade>> {
        val port = airPorts.getIfAvailable() ?: return AlertRead.Unknown(OFF)
        val searchDate = LocalDate.ofInstant(at, KST)
        val forecast = synchronized(airLock) {
            airMemo?.takeIf { it.searchDate == searchDate && at < it.until }?.forecast
                ?: when (val read = read { port.fetchAirForecast(searchDate) }) {
                    is AlertRead.Ok -> read.value.also {
                        airMemo = AirMemo(searchDate, it, maxOf(it.issuedAt.plus(AIR_NEXT_RELEASE), at.plus(MIN_HOLD)))
                    }
                    is AlertRead.Unknown -> return read
                }
        }
        return forecast.byDate[date]?.let { AlertRead.Ok(it) } ?: AlertRead.Unknown(NO_FORECAST)
    }

    /** 포트의 실패 예외를 모름으로 — 원인 코드만(키·주소 없음). 그 밖의 예외는 결함이라 그대로 던진다. */
    private inline fun <T> read(fetch: () -> T): AlertRead<T> = try {
        AlertRead.Ok(fetch())
    } catch (e: WeatherGatewayRefused) {
        AlertRead.Unknown("gateway:${e.reasonCode}")
    } catch (e: WeatherLookupFailed) {
        AlertRead.Unknown(UNAVAILABLE)
    }

    private class AirMemo(val searchDate: LocalDate, val forecast: AirForecast, val until: Instant)

    private companion object {
        private val KST: ZoneId = ZoneId.of("Asia/Seoul")

        /** 특보 기억 — 회차 예산(20분) 동안 한 번(COST-SA-03). */
        private val WARNING_HOLD: Duration = Duration.ofMinutes(20)

        /** 대기질 다음 발표(6시간 간격) + 제공 지연. 지연은 실측 전 값이다 — 늦으면 다음 회차가 한 번 더 묻는다. */
        private val AIR_NEXT_RELEASE: Duration = Duration.ofHours(6).plusMinutes(30)

        /** 옛 발표분을 다시 받아도 이만큼은 기억한다 — 한 회차 안에서 여행마다 다시 부르지 않게. */
        private val MIN_HOLD: Duration = Duration.ofMinutes(20)

        private const val OFF = "off"
        private const val UNAVAILABLE = "unavailable"
        private const val NO_FORECAST = "no-forecast"
    }
}
