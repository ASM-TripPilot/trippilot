package com.trippilot.weathercontext.application

import com.trippilot.weathercontext.api.HourlyForecastUnavailable
import com.trippilot.weathercontext.api.HourlyWeather
import com.trippilot.weathercontext.api.Precipitation
import com.trippilot.weathercontext.api.Sky
import com.trippilot.weathercontext.domain.GridForecast
import com.trippilot.weathercontext.domain.GridForecastMissing
import com.trippilot.weathercontext.domain.GridForecastPort
import com.trippilot.weathercontext.domain.GridForecastRepository
import com.trippilot.weathercontext.domain.GridHour
import com.trippilot.weathercontext.domain.WeatherGatewayRefused
import com.trippilot.weathercontext.domain.WeatherLookupFailed
import io.kotest.assertions.throwables.shouldThrow
import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.maps.shouldBeEmpty
import io.kotest.matchers.nulls.shouldBeNull
import io.kotest.matchers.shouldBe
import org.springframework.beans.factory.ObjectProvider
import org.springframework.dao.DataIntegrityViolationException
import java.time.Clock
import java.time.Duration
import java.time.Instant
import java.time.LocalDateTime
import java.time.ZoneOffset
import java.util.stream.Stream

/**
 * 격자 예보 읽기-통과 캐시(설계서 T-D2-U · domain-entities §8.1).
 *
 * 지키려는 것:
 * - 신선하면 원천을 부르지 않는다(같은 격자의 좌표 여럿도 1회) — 한도를 AI 와 나눠 쓴다(COST-SA-01)
 * - **정상만 저장**한다 — 실패·자료 없음·게이트웨이 거절은 행을 만들지 않는다(INV-U4-09 · anti-patterns #1135)
 * - 받은 값도 신선해야 쓴다 — 낡은 근거로 개입하면 그게 허위 알림이다
 * - 격자 포트가 없으면(가짜 날씨) live 가 아니다 — 저장소도 건드리지 않는다
 */
class HourlyForecastServiceTest : StringSpec({

    val now = Instant.parse("2026-10-20T00:30:00Z") // KST 09:30
    val base = Instant.parse("2026-10-19T23:00:00Z") // KST 08:00 발표
    val expires = base.plus(Duration.ofMinutes(190)) // 발표 + 3시간 10분
    val noon = LocalDateTime.parse("2026-10-20T12:00")

    fun grid(key: String = JEJU, baseAt: Instant = base, expiresAt: Instant = expires, pty: Int? = 1, sky: Int? = 4) = GridForecast(
        gridKey = key, baseAt = baseAt,
        hourly = mapOf(noon to GridHour(pop = 70, pty = pty, sky = sky, tmp = 18.5, wsd = 4.0)),
        fetchedAt = baseAt, expiresAt = expiresAt,
    )

    fun service(port: GridForecastPort?, repo: GridForecastRepository) =
        HourlyForecastService(providerOf(port), repo, Clock.fixed(now, ZoneOffset.UTC))

    "신선한 캐시가 있으면 원천을 부르지 않는다" {
        val port = CountingGrids { grid() }
        val repo = GridRows(grid())

        val got = service(port, repo).forecastForTrigger(33.4996, 126.5312, now)!!

        port.fetches shouldBe 0
        got.gridKey shouldBe JEJU
        got.baseAt shouldBe base
    }

    "낡았으면 한 번 부르고 저장한다 — 받은 발표분을 그대로 돌려준다" {
        val port = CountingGrids { grid() }
        val stale = grid(baseAt = base.minus(Duration.ofHours(3)), expiresAt = base.minus(Duration.ofMinutes(10)))
        val repo = GridRows(stale)

        val got = service(port, repo).forecastForTrigger(33.4996, 126.5312, now)!!

        port.fetches shouldBe 1
        port.fetchedAt.single() shouldBe now // 부를 때의 시각은 시계다(발표분 선택은 실제 시각을 따른다)
        repo.rows[JEJU] shouldBe grid()
        got.baseAt shouldBe base
    }

    "같은 격자에 든 두 좌표는 한 번만 부른다" {
        val port = CountingGrids { grid() }
        val svc = service(port, GridRows())

        svc.forecastForTrigger(33.4996, 126.5312, now)
        svc.forecastForTrigger(33.4990, 126.5300, now) // 같은 5km 격자

        port.fetches shouldBe 1
    }

    "자료 없음(03 소진·상한)은 모름(null)이고 행을 만들지 않는다" {
        val repo = GridRows()
        val port = CountingGrids { throw GridForecastMissing(JEJU, "03") }

        service(port, repo).forecastForTrigger(33.4996, 126.5312, now).shouldBeNull()
        repo.rows.shouldBeEmpty()
    }

    "장애(시한·5xx·형식)는 그 격자의 고장으로 올리고 행을 만들지 않는다" {
        val repo = GridRows()
        val port = CountingGrids { throw WeatherLookupFailed("타임아웃") }

        val e = shouldThrow<HourlyForecastUnavailable> { service(port, repo).forecastForTrigger(33.4996, 126.5312, now) }

        e.gridKey shouldBe JEJU
        e.gatewayCode.shouldBeNull()
        e.cause.shouldBeNull() // 원인 예외를 매달지 않는다 — 요청 주소(서비스 키)가 원인 메시지에 있을 수 있다
        repo.rows.shouldBeEmpty()
    }

    "게이트웨이 거절은 출처 전체의 고장으로 올리고 캐시하지 않는다" {
        val repo = GridRows()
        val port = CountingGrids { throw WeatherGatewayRefused("30") }

        val e = shouldThrow<HourlyForecastUnavailable> { service(port, repo).forecastForTrigger(33.4996, 126.5312, now) }

        e.gatewayCode shouldBe "30"
        repo.rows.shouldBeEmpty()
    }

    "받은 값이 판정 시각에 이미 낡았으면 쓰지 않고 저장하지도 않는다" {
        val repo = GridRows()
        val port = CountingGrids { grid() }

        service(port, repo).forecastForTrigger(33.4996, 126.5312, expires).shouldBeNull()
        repo.rows.shouldBeEmpty()
    }

    /** 두 스레드가 같은 격자를 동시에 처음 받으면 늦은 쪽 INSERT 가 격자 PK 에 걸린다 — 받은 값은 멀쩡하니 그대로 쓴다. */
    "같은 격자 동시 저장의 키 충돌은 삼키고 받은 값을 쓴다" {
        val port = CountingGrids { grid() }
        val clash = object : GridForecastRepository {
            override fun find(gridKey: String): GridForecast? = null
            override fun save(forecast: GridForecast): GridForecast = throw DataIntegrityViolationException("pk_weather_grid_forecast")
        }

        service(port, clash).forecastForTrigger(33.4996, 126.5312, now)!!.gridKey shouldBe JEJU
    }

    "격자 포트가 없으면(가짜 날씨) live 가 아니고 저장소도 건드리지 않는다" {
        val untouched = object : GridForecastRepository {
            override fun find(gridKey: String): GridForecast = error("가짜 날씨에서 캐시를 읽으면 안 된다")
            override fun save(forecast: GridForecast): GridForecast = error("가짜 날씨에서 캐시를 쓰면 안 된다")
        }
        val svc = service(null, untouched)

        svc.isLive() shouldBe false
        svc.gridKeyOf(33.4996, 126.5312).shouldBeNull()
        svc.forecastForTrigger(33.4996, 126.5312, now).shouldBeNull()
    }

    "포트가 있으면 live 이고 격자 키는 포트가 정한다" {
        val svc = service(CountingGrids { grid() }, GridRows())

        svc.isLive() shouldBe true
        svc.gridKeyOf(33.4996, 126.5312) shouldBe JEJU
    }

    /** 원천 코드 → 뜻 — 단기예보 PTY 0~4 · SKY 1·3·4 전부. 모르면 null(어댑터가 이미 걸렀다). */
    "원천 코드를 뜻으로 옮긴다 — PTY 0~4 · SKY 1·3·4 · 모름은 null" {
        val ptys = listOf(0 to Precipitation.NONE, 1 to Precipitation.RAIN, 2 to Precipitation.RAIN_SNOW, 3 to Precipitation.SNOW, 4 to Precipitation.SHOWER, null to null)
        val skies = listOf(1 to Sky.CLEAR, 3 to Sky.MOSTLY_CLOUDY, 4 to Sky.OVERCAST, null to null)
        ptys.forEach { (code, meaning) ->
            val got = service(CountingGrids { grid(pty = code) }, GridRows()).forecastForTrigger(33.4996, 126.5312, now)!!
            got.hourly[noon]!!.precipitation shouldBe meaning
        }
        skies.forEach { (code, meaning) ->
            val got = service(CountingGrids { grid(sky = code) }, GridRows()).forecastForTrigger(33.4996, 126.5312, now)!!
            got.hourly[noon]!!.sky shouldBe meaning
        }
        val got = service(CountingGrids { grid() }, GridRows()).forecastForTrigger(33.4996, 126.5312, now)!!
        got.hourly[noon] shouldBe HourlyWeather(70, Precipitation.RAIN, Sky.OVERCAST, 18.5, 4.0)
    }
})

private const val JEJU = "53,38"

/** 격자 포트 대역 — 제주 근방 좌표는 모두 53,38 이다. 실물처럼 실패는 예외로 낸다. */
private class CountingGrids(private val answer: () -> GridForecast) : GridForecastPort {
    var fetches = 0
    val fetchedAt = mutableListOf<Instant>()
    override fun gridKeyOf(lat: Double, lng: Double): String = if (lat in 33.4..33.6 && lng in 126.4..126.6) JEJU else "$lat,$lng"
    override fun fetchGrid(gridKey: String, at: Instant): GridForecast {
        fetches++
        fetchedAt += at
        return answer()
    }
}

private class GridRows(vararg seed: GridForecast) : GridForecastRepository {
    val rows = linkedMapOf<String, GridForecast>().apply { seed.forEach { put(it.gridKey, it) } }
    override fun find(gridKey: String) = rows[gridKey]
    override fun save(forecast: GridForecast) = forecast.also { rows[it.gridKey] = it }
}

private fun providerOf(port: GridForecastPort?): ObjectProvider<GridForecastPort> = object : ObjectProvider<GridForecastPort> {
    override fun getObject(): GridForecastPort = port ?: error("없음")
    override fun getIfAvailable(): GridForecastPort? = port
    override fun stream(): Stream<GridForecastPort> = Stream.ofNullable(port)
    override fun orderedStream(): Stream<GridForecastPort> = Stream.ofNullable(port)
}
