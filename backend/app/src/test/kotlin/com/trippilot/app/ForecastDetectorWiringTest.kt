package com.trippilot.app

import com.trippilot.itinerarygeneration.api.ItineraryFacade
import com.trippilot.itinerarygeneration.api.ItineraryPlanFacade
import com.trippilot.placedata.api.RegionLookupFacade
import com.trippilot.planbdetection.application.KmaForecastDetector
import com.trippilot.planbdetection.application.SituationSweep
import com.trippilot.planbdetection.application.SituationSweepConfiguration
import com.trippilot.planbdetection.application.TriggerService
import com.trippilot.planbdetection.application.WatchingSources
import com.trippilot.planbdetection.domain.PlanBTriggerRepository
import com.trippilot.planbdetection.domain.PlanBWatchRepository
import com.trippilot.planbdetection.domain.SweepSource
import com.trippilot.trip.api.TripWatchFacade
import com.trippilot.weathercontext.adapter.out.external.KmaWeatherAdapter
import com.trippilot.weathercontext.adapter.out.external.KmaWeatherConfiguration
import com.trippilot.weathercontext.api.HourlyForecastFacade
import com.trippilot.weathercontext.application.HourlyForecastService
import com.trippilot.weathercontext.domain.GridForecastPort
import com.trippilot.weathercontext.domain.GridForecastRepository
import com.trippilot.weathercontext.domain.WeatherPort
import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.maps.shouldBeEmpty
import io.kotest.matchers.shouldBe
import io.kotest.matchers.string.shouldContain
import io.kotest.matchers.types.shouldBeInstanceOf
import io.kotest.matchers.types.shouldBeSameInstanceAs
import io.mockk.mockk
import org.springframework.boot.test.context.runner.ApplicationContextRunner
import java.time.Clock
import java.util.UUID
import java.util.function.Supplier

/**
 * 단기예보 감지기 ↔ 상황 감시 스윕 배선(PR-A2 위) — **실 설정 클래스와 조건부 빈**으로 두 모드를 조립해 본다.
 *
 * 끊겨도 아무것도 빨개지지 않는 자리다: 실 기상청 모드에서 격자 포트가 안 잡히면 감지기가 live 가 아니고 스윕은 그 출처를
 * '꺼짐'으로 보고 조용히 돈다. 반대로 가짜 날씨에서 live 로 잡히면 감시 상태가 '꺼짐' 대신 '확인 불가'로 그려지고 회차마다
 * 모름이 쌓인다 — 출처를 끈 것과 장애가 구분되지 않는다.
 * DB·외부 호출 없이 빈 구성만 본다(캐시 저장소·스윕 협력자는 대역). 어댑터 빈의 선언 타입은 `KmaWeatherWiringTest` 가 못 박는다 —
 * 다 뜬 컨텍스트에서는 인스턴스 타입으로 맞춰져 여기서는 안 보인다.
 */
class ForecastDetectorWiringTest : StringSpec({

    val anyone = UUID.randomUUID() // 허용목록이 비어 전원이 대상이다

    fun runner(): ApplicationContextRunner = ApplicationContextRunner()
        .withUserConfiguration(
            KmaWeatherConfiguration::class.java, HourlyForecastService::class.java, KmaForecastDetector::class.java,
            SituationSweepConfiguration::class.java, SituationSweep::class.java,
        )
        .withBean(RegionLookupFacade::class.java, Supplier { mockk<RegionLookupFacade>(relaxed = true) })
        .withBean(GridForecastRepository::class.java, Supplier { mockk<GridForecastRepository>(relaxed = true) })
        .withBean(TripWatchFacade::class.java, Supplier { mockk<TripWatchFacade>(relaxed = true) })
        .withBean(ItineraryFacade::class.java, Supplier { mockk<ItineraryFacade>(relaxed = true) })
        .withBean(ItineraryPlanFacade::class.java, Supplier { mockk<ItineraryPlanFacade>(relaxed = true) })
        .withBean(TriggerService::class.java, Supplier { mockk<TriggerService>(relaxed = true) })
        .withBean(PlanBTriggerRepository::class.java, Supplier { mockk<PlanBTriggerRepository>(relaxed = true) })
        .withBean(PlanBWatchRepository::class.java, Supplier { mockk<PlanBWatchRepository>(relaxed = true) })
        .withBean(Clock::class.java, Supplier { Clock.systemUTC() })
        .withPropertyValues("trippilot.planb.situation-sweep.mode=on")

    "실 기상청(kma)이면 단기예보 감지기가 감시 출처로 live 다 — 이름 경로와 격자 경로가 같은 어댑터 빈이다" {
        runner().withPropertyValues("trippilot.weather.mode=kma", "trippilot.weather.service-key=test-key").run { ctx ->
            ctx.getBean(GridForecastPort::class.java).shouldBeInstanceOf<KmaWeatherAdapter>()
            ctx.getBean(GridForecastPort::class.java) shouldBeSameInstanceAs ctx.getBean(WeatherPort::class.java)
            ctx.getBean(HourlyForecastFacade::class.java).isLive() shouldBe true
            ctx.getBean(WatchingSources::class.java).isWatching(SweepSource.KMA_FORECAST, anyone) shouldBe true
            ctx.getBean(SituationSweep::class.java).announcement() shouldContain "감지기 live=[kma-forecast]"
        }
    }

    "가짜 날씨(fake)면 격자 포트가 없어 감지기 빈이 있어도 off 다 — 확인 불가가 아니라 꺼짐으로 보인다" {
        runner().withPropertyValues("trippilot.weather.mode=fake").run { ctx ->
            ctx.getBeansOfType(GridForecastPort::class.java).shouldBeEmpty()
            ctx.getBean(KmaForecastDetector::class.java).isLive() shouldBe false
            ctx.getBean(WatchingSources::class.java).isWatching(SweepSource.KMA_FORECAST, anyone) shouldBe false
            ctx.getBean(SituationSweep::class.java).announcement() shouldContain "감지기 live=[]"
        }
    }
})
