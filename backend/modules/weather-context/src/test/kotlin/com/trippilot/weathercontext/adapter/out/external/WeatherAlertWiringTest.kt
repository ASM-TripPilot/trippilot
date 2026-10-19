package com.trippilot.weathercontext.adapter.out.external

import ch.qos.logback.classic.Level
import ch.qos.logback.classic.Logger
import ch.qos.logback.classic.spi.ILoggingEvent
import ch.qos.logback.core.read.ListAppender
import com.sun.net.httpserver.HttpServer
import com.trippilot.weathercontext.api.WeatherAlertFacade
import com.trippilot.weathercontext.application.WeatherAlertService
import com.trippilot.weathercontext.domain.AirForecastPort
import com.trippilot.weathercontext.domain.WarningStatusPort
import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.maps.shouldBeEmpty
import io.kotest.matchers.shouldBe
import io.kotest.matchers.string.shouldContain
import io.kotest.matchers.string.shouldNotContain
import io.kotest.matchers.types.shouldBeInstanceOf
import org.slf4j.LoggerFactory
import org.springframework.boot.test.context.runner.ApplicationContextRunner
import java.net.InetSocketAddress

/**
 * 특보·대기질 어댑터 배선 — **모드를 켜면 구현이 붙는가 · 어느 키로 묻는가**(설정 스위치는 '값이 붙는가'와 '구현이 바뀌는가'를
 * 따로 잰다 — anti-patterns).
 *
 * 키는 공공데이터포털 `PUBLIC_DATA_API_KEY`(특보·대기질 활용신청 계정)이고, 비면 기상청 키(`WEATHER_API`)로 대신한다. compose 는
 * 설정하지 않은 env 를 **빈 문자열**로 넘기므로 yml 중첩 기본값(`${'$'}{A:${'$'}{B:}}`)으로는 대신이 안 된다 — 코드가 빈 값을 본다.
 * 그래서 실제로 나간 질의의 키로 확인한다.
 */
class WeatherAlertWiringTest : StringSpec({

    fun runner(): ApplicationContextRunner = ApplicationContextRunner()
        .withUserConfiguration(WeatherAlertConfiguration::class.java, WeatherAlertService::class.java)

    "실 기상청(kma)이면 특보·대기질 어댑터가 붙고 live 다" {
        runner().withPropertyValues("trippilot.weather.mode=kma", "trippilot.weather.service-key=weather-key").run { ctx ->
            ctx.getBean(WarningStatusPort::class.java).shouldBeInstanceOf<KmaWarningAdapter>()
            ctx.getBean(AirForecastPort::class.java).shouldBeInstanceOf<AirKoreaAdapter>()
            ctx.getBean(WeatherAlertFacade::class.java).isLive() shouldBe true
        }
    }

    "가짜 날씨(fake·미설정)면 어댑터가 없고 live 가 아니다 — 호출 0" {
        listOf(arrayOf("trippilot.weather.mode=fake"), emptyArray()).forEach { props ->
            runner().withPropertyValues(*props).run { ctx ->
                ctx.getBeansOfType(WarningStatusPort::class.java).shouldBeEmpty()
                ctx.getBeansOfType(AirForecastPort::class.java).shouldBeEmpty()
                ctx.getBean(WeatherAlertFacade::class.java).isLive() shouldBe false
            }
        }
    }

    /** 스프링은 인스턴스 전에 팩토리 메서드의 선언 타입으로 빈 타입을 예측한다 — 어댑터로 선언해야 포트로 보인다(`KmaWeatherWiringTest` 선례). */
    "빈 선언 타입이 어댑터다 — 포트로 예측된다" {
        val methods = WeatherAlertConfiguration::class.java.declaredMethods.associateBy { it.name }
        methods.getValue("kmaWarningAdapter").returnType shouldBe KmaWarningAdapter::class.java
        methods.getValue("airKoreaAdapter").returnType shouldBe AirKoreaAdapter::class.java
    }

    "공공데이터포털 키가 있으면 그 키로 묻는다" {
        withQueryServer { url, queries ->
            runner().withPropertyValues(
                "trippilot.weather.mode=kma", "trippilot.weather.service-key=weather-key",
                "trippilot.weather.public-data-key=public-key", "trippilot.weather.warning-base-url=$url",
            ).run { ctx -> runCatching { ctx.getBean(WarningStatusPort::class.java).fetchWarnings() } }

            queries.single() shouldContain "serviceKey=public-key&"
        }
    }

    /** compose 가 미설정 env 를 빈 값으로 넘긴 경우 — 공백뿐인 값도 비었다. */
    "공공데이터포털 키가 비면(빈 문자열·공백) 기상청 키로 묻는다" {
        listOf("", "  ").forEach { blank ->
            withQueryServer { url, queries ->
                runner().withPropertyValues(
                    "trippilot.weather.mode=kma", "trippilot.weather.service-key=weather-key",
                    "trippilot.weather.public-data-key=$blank", "trippilot.weather.air-base-url=$url",
                ).run { ctx -> runCatching { ctx.getBean(AirForecastPort::class.java).fetchAirForecast(java.time.LocalDate.parse("2026-10-19")) } }

                queries.first() shouldContain "serviceKey=weather-key&"
            }
        }
    }

    "기동 줄은 키를 읽은 env 이름만 말한다 — 값은 싣지 않는다" {
        val lines = configurationLogs {
            runner().withPropertyValues("trippilot.weather.mode=kma", "trippilot.weather.service-key=weather-secret")
                .run { it.getBean(WarningStatusPort::class.java) }
            runner().withPropertyValues(
                "trippilot.weather.mode=kma", "trippilot.weather.service-key=weather-secret", "trippilot.weather.public-data-key=public-secret",
            ).run { it.getBean(WarningStatusPort::class.java) }
        }

        lines.size shouldBe 2
        lines[0] shouldContain "WEATHER_API(PUBLIC_DATA_API_KEY 비어 대체)"
        lines[1] shouldContain "키=PUBLIC_DATA_API_KEY"
        lines.forEach {
            it shouldNotContain "secret"
        }
    }

    /**
     * 인코딩 키(`%2B` · `%3D`)를 넣으면 질의에서 한 번 더 인코딩돼(`%252B`) 매 회차 게이트웨이 거절(403·30)이고, 남는 것은 원인 코드뿐이라
     * 키 미등록처럼 보인다(anti-patterns — 실측으로 겪은 실수). 기동에서 env 이름으로 짚는다 — 값은 싣지 않는다.
     */
    "PUBLIC_DATA_API_KEY 에 '%' 가 있으면 기동 WARN 한 줄 — env 이름만, 값은 싣지 않는다" {
        val warns = configurationWarns {
            runner().withPropertyValues(
                "trippilot.weather.mode=kma", "trippilot.weather.service-key=weather-secret", "trippilot.weather.public-data-key=pub%2Bsecret%3D%3D",
            ).run { it.getBean(WarningStatusPort::class.java) }
            runner().withPropertyValues(
                "trippilot.weather.mode=kma", "trippilot.weather.service-key=weather-secret", "trippilot.weather.public-data-key=pub+secret==",
            ).run { it.getBean(WarningStatusPort::class.java) }
        }

        warns.size shouldBe 1
        warns.single() shouldContain "PUBLIC_DATA_API_KEY"
        warns.single() shouldNotContain "secret"
    }

    "기본 원천 주소 — 기상특보 조회서비스 · 에어코리아 대기오염정보" {
        val properties = KmaWeatherProperties()
        properties.warningBaseUrl shouldBe "https://apis.data.go.kr/1360000/WthrWrnInfoService"
        properties.airBaseUrl shouldBe "https://apis.data.go.kr/B552584/ArpltnInforInqireSvc"
        properties.publicDataKey shouldBe ""
    }
})

/** 받은 질의를 모은다 — 응답은 503(어댑터는 실패로 끝나지만 질의는 이미 나갔다). */
private fun withQueryServer(block: (baseUrl: String, queries: List<String>) -> Unit) {
    val queries = mutableListOf<String>()
    val server = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0)
    server.createContext("/") { ex ->
        queries += ex.requestURI.rawQuery ?: ""
        ex.sendResponseHeaders(503, -1)
        ex.close()
    }
    server.start()
    try {
        block("http://127.0.0.1:${server.address.port}", queries)
    } finally {
        server.stop(0)
    }
}

/** 설정 클래스의 INFO 기동 줄. */
private fun configurationLogs(block: () -> Unit): List<String> =
    configurationEvents(block).filter { it.level == Level.INFO }.map { it.formattedMessage }

/** 설정 클래스의 WARN 줄. */
private fun configurationWarns(block: () -> Unit): List<String> =
    configurationEvents(block).filter { it.level == Level.WARN }.map { it.formattedMessage }

private fun configurationEvents(block: () -> Unit): List<ILoggingEvent> {
    val logger = LoggerFactory.getLogger(WeatherAlertConfiguration::class.java) as Logger
    val appender = ListAppender<ILoggingEvent>().apply { start() }
    logger.addAppender(appender)
    try {
        block()
    } finally {
        logger.detachAppender(appender)
    }
    return appender.list.toList()
}
