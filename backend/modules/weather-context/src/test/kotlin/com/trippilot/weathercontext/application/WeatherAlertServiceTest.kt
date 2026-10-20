package com.trippilot.weathercontext.application

import com.trippilot.weathercontext.api.ActiveWarning
import com.trippilot.weathercontext.api.AirGrade
import com.trippilot.weathercontext.api.AirRegion
import com.trippilot.weathercontext.api.AlertRead
import com.trippilot.weathercontext.api.WarningArea
import com.trippilot.weathercontext.domain.AirForecast
import com.trippilot.weathercontext.domain.AirForecastPort
import com.trippilot.weathercontext.domain.WarningStatusPort
import com.trippilot.weathercontext.domain.WeatherGatewayRefused
import com.trippilot.weathercontext.domain.WeatherLookupFailed
import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.shouldBe
import org.springframework.beans.factory.ObjectProvider
import java.time.Duration
import java.time.Instant
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.ZoneId
import java.util.concurrent.Callable
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import java.util.stream.Stream

/**
 * 특보·대기질 읽기 — 파드 메모리 기억(특보 20분 · 대기질 발표 단위)과 실패의 모양(domain-entities §8.2 · COST-SA-03~05).
 * 성공만 기억한다 — 게이트웨이 거절·장애는 기억하지 않고 다음 회차에 다시 묻는다(그 회차 안의 반복 호출을 막는 것은 감지기 몫).
 * 포트 대역은 실물처럼 예외로 실패한다.
 */
class WeatherAlertServiceTest : StringSpec({

    "포트 빈이 있어야 live 다 — 가짜 날씨면 둘 다 없다" {
        WeatherAlertService(providerOf(FakeWarnings()), providerOf(FakeAir())).isLive() shouldBe true
        WeatherAlertService(providerOf<WarningStatusPort>(null), providerOf<AirForecastPort>(null)).isLive() shouldBe false
    }

    "live 가 아니면 부르지 않고 모름이다" {
        val service = WeatherAlertService(providerOf<WarningStatusPort>(null), providerOf<AirForecastPort>(null))

        service.warnings(AT) shouldBe AlertRead.Unknown("off")
        service.airGrades(TODAY, AT) shouldBe AlertRead.Unknown("off")
    }

    "특보는 20분 기억한다 — 20분이 지나면 다시 묻는다" {
        val port = FakeWarnings().answer { listOf(GALE) }
        val service = WeatherAlertService(providerOf(port), providerOf(FakeAir()))

        service.warnings(AT) shouldBe AlertRead.Ok(listOf(GALE))
        service.warnings(AT.plus(Duration.ofMinutes(20)).minusMillis(1)) shouldBe AlertRead.Ok(listOf(GALE))
        port.calls.get() shouldBe 1

        service.warnings(AT.plus(Duration.ofMinutes(20)))
        port.calls.get() shouldBe 2
    }

    "특보 실패는 기억하지 않는다 — 게이트웨이 거절은 원인 코드, 장애는 unavailable, 다음 물음에 다시 부른다" {
        val port = FakeWarnings().answer { throw WeatherGatewayRefused("30") }
        val service = WeatherAlertService(providerOf(port), providerOf(FakeAir()))

        service.warnings(AT) shouldBe AlertRead.Unknown("gateway:30")
        port.answer { throw WeatherLookupFailed("기상특보 조회 실패(HTTP 503)") }
        service.warnings(AT) shouldBe AlertRead.Unknown("unavailable")
        port.answer { emptyList() }
        service.warnings(AT) shouldBe AlertRead.Ok(emptyList())
        port.calls.get() shouldBe 3
    }

    "대기질은 그 날 예보만 — 예보에 없는 날은 모름이다" {
        val port = FakeAir().answer { forecastAt("05:00", TODAY to SEOUL_GOOD, TOMORROW to SEOUL_BAD) }
        val service = WeatherAlertService(providerOf(FakeWarnings()), providerOf(port))

        service.airGrades(TODAY, AT) shouldBe AlertRead.Ok(SEOUL_GOOD)
        service.airGrades(TOMORROW, AT) shouldBe AlertRead.Ok(SEOUL_BAD)
        service.airGrades(TOMORROW.plusDays(1), AT) shouldBe AlertRead.Unknown("no-forecast")
        port.calls.get() shouldBe 1
        port.searched shouldBe listOf(TODAY)
    }

    /** 발표 단위 기억 — 05·11·17·23시 발표, 제공 지연을 30분 본다. 늦은 발표로 옛 발표분을 받아도 20분은 기억한다(회차 안 반복 호출 방지). */
    "대기질은 다음 발표(+30분)까지 기억한다 — 늦게 나와 옛 발표분을 받으면 20분 뒤에 다시 묻는다" {
        val port = FakeAir().answer { forecastAt("05:00", TODAY to SEOUL_GOOD) }
        val service = WeatherAlertService(providerOf(FakeWarnings()), providerOf(port))

        service.airGrades(TODAY, kst("2026-10-19T07:15"))
        service.airGrades(TODAY, kst("2026-10-19T11:29"))
        port.calls.get() shouldBe 1

        service.airGrades(TODAY, kst("2026-10-19T12:15")) // 11시 발표분이 아직 없어 05시 발표분을 또 받았다
        service.airGrades(TODAY, kst("2026-10-19T12:34"))
        port.calls.get() shouldBe 2
        service.airGrades(TODAY, kst("2026-10-19T12:35"))
        port.calls.get() shouldBe 3
    }

    "날짜가 바뀌면 기억을 쓰지 않는다 — 묻는 날짜(KST)가 다르다" {
        val port = FakeAir().answer { forecastAt("23:00", TODAY to SEOUL_GOOD, TOMORROW to SEOUL_BAD) }
        val service = WeatherAlertService(providerOf(FakeWarnings()), providerOf(port))

        service.airGrades(TOMORROW, kst("2026-10-19T23:40"))
        service.airGrades(TOMORROW, kst("2026-10-20T00:10"))

        port.searched shouldBe listOf(TODAY, TOMORROW)
    }

    "대기질 실패는 기억하지 않는다" {
        val port = FakeAir().answer { throw WeatherGatewayRefused("HTTP_401") }
        val service = WeatherAlertService(providerOf(FakeWarnings()), providerOf(port))

        service.airGrades(TODAY, AT) shouldBe AlertRead.Unknown("gateway:HTTP_401")
        port.answer { throw WeatherLookupFailed("에어코리아 대기질 조회 실패(형식 깨짐)") }
        service.airGrades(TODAY, AT) shouldBe AlertRead.Unknown("unavailable")
        port.calls.get() shouldBe 2
    }

    /** 여행 단위 병렬(2)이라 회차 첫머리에 두 여행이 함께 묻는다 — 원천은 한 번만 부른다(COST-SA-03 회차당 1콜). */
    "동시에 처음 물어도 원천은 한 번 부른다" {
        val entered = CountDownLatch(1)
        val port = FakeWarnings().answer {
            entered.countDown()
            Thread.sleep(200)
            listOf(GALE)
        }
        val service = WeatherAlertService(providerOf(port), providerOf(FakeAir()))
        val pool = Executors.newFixedThreadPool(2)

        val results = try {
            val first = pool.submit(Callable { service.warnings(AT) })
            entered.await(5, TimeUnit.SECONDS)
            val second = pool.submit(Callable { service.warnings(AT) })
            listOf(first, second).map { it.get(10, TimeUnit.SECONDS) }
        } finally {
            pool.shutdownNow()
        }

        results shouldBe listOf(AlertRead.Ok(listOf(GALE)), AlertRead.Ok(listOf(GALE)))
        port.calls.get() shouldBe 1
    }
})

private val KST: ZoneId = ZoneId.of("Asia/Seoul")
private fun kst(local: String): Instant = LocalDateTime.parse(local).atZone(KST).toInstant()

private val TODAY: LocalDate = LocalDate.parse("2026-10-19")
private val TOMORROW: LocalDate = TODAY.plusDays(1)
private val AT: Instant = kst("2026-10-19T13:15")

private val GALE = ActiveWarning("강풍", "주의보", listOf(WarningArea("울산")))
private val SEOUL_GOOD = mapOf(AirRegion.SEOUL to AirGrade("좋음", "보통"))
private val SEOUL_BAD = mapOf(AirRegion.SEOUL to AirGrade("나쁨", "보통"))

private fun forecastAt(hhmm: String, vararg byDate: Pair<LocalDate, Map<AirRegion, AirGrade>>) =
    AirForecast(TODAY.atTime(java.time.LocalTime.parse(hhmm)).atZone(KST).toInstant(), byDate.toMap())

private class FakeWarnings : WarningStatusPort {
    val calls = AtomicInteger()
    @Volatile private var answer: () -> List<ActiveWarning> = { emptyList() }
    fun answer(next: () -> List<ActiveWarning>) = apply { answer = next }
    override fun fetchWarnings(): List<ActiveWarning> {
        calls.incrementAndGet()
        return answer()
    }
}

private class FakeAir : AirForecastPort {
    val calls = AtomicInteger()
    val searched = mutableListOf<LocalDate>()
    @Volatile private var answer: () -> AirForecast = { AirForecast(Instant.EPOCH, emptyMap()) }
    fun answer(next: () -> AirForecast) = apply { answer = next }
    override fun fetchAirForecast(searchDate: LocalDate): AirForecast {
        calls.incrementAndGet()
        searched += searchDate
        return answer()
    }
}

private fun <T : Any> providerOf(bean: T?): ObjectProvider<T> = object : ObjectProvider<T> {
    override fun getObject(): T = bean ?: error("빈이 없습니다.")
    override fun getIfAvailable(): T? = bean
    override fun stream(): Stream<T> = Stream.ofNullable(bean)
    override fun orderedStream(): Stream<T> = Stream.ofNullable(bean)
}
