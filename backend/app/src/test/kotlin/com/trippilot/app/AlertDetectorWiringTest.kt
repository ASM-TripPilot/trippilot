package com.trippilot.app

import com.trippilot.itinerarygeneration.api.ItineraryFacade
import com.trippilot.itinerarygeneration.api.ItineraryPlanFacade
import com.trippilot.placedata.api.RegionLookupFacade
import com.trippilot.planbdetection.application.AirQualityDetector
import com.trippilot.planbdetection.application.KmaWarningDetector
import com.trippilot.planbdetection.application.SituationSweep
import com.trippilot.planbdetection.application.SituationSweepConfiguration
import com.trippilot.planbdetection.application.TriggerService
import com.trippilot.planbdetection.application.WatchingSources
import com.trippilot.planbdetection.domain.PlanBTriggerRepository
import com.trippilot.planbdetection.domain.PlanBWatchRepository
import com.trippilot.planbdetection.domain.SweepSource
import com.trippilot.trip.api.TripFacade
import com.trippilot.trip.api.TripWatchFacade
import com.trippilot.weathercontext.adapter.out.external.KmaWeatherConfiguration
import com.trippilot.weathercontext.adapter.out.external.WeatherAlertConfiguration
import com.trippilot.weathercontext.application.WeatherAlertService
import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.shouldBe
import io.kotest.matchers.string.shouldContain
import io.mockk.mockk
import org.springframework.boot.test.context.runner.ApplicationContextRunner
import java.time.Clock
import java.util.UUID
import java.util.function.Supplier

/**
 * 특보·대기질 감지기 ↔ 상황 감시 스윕 배선 — **실 설정 클래스와 조건부 빈**으로 두 모드를 조립해 본다(`ForecastDetectorWiringTest` 와 같은 꼴).
 *
 * 두 출처는 관찰 전용으로 출발한다(BR-SA-04): 실 기상청 모드에서 감지기는 live 라 회차마다 불리지만(요약·표본 줄로 잰다) 감시 중이
 * 아니다 — 트리거를 쓰지 않고, 조회 API 는 그 출처의 트리거를 숨긴다. 관찰 전용 목록에서 빼는 것이 켜기다 — 그때 감시 중이 된다.
 * 가짜 날씨면 포트 빈이 없어 live 가 아니다(호출 0) — '확인 불가'가 아니라 '꺼짐'으로 보인다.
 */
class AlertDetectorWiringTest : StringSpec({

    val anyone = UUID.randomUUID() // 허용목록이 비어 전원이 대상이다

    fun runner(): ApplicationContextRunner = ApplicationContextRunner()
        .withUserConfiguration(
            KmaWeatherConfiguration::class.java, WeatherAlertConfiguration::class.java, WeatherAlertService::class.java,
            KmaWarningDetector::class.java, AirQualityDetector::class.java,
            SituationSweepConfiguration::class.java, SituationSweep::class.java,
        )
        .withBean(RegionLookupFacade::class.java, Supplier { mockk<RegionLookupFacade>(relaxed = true) })
        .withBean(TripFacade::class.java, Supplier { mockk<TripFacade>(relaxed = true) })
        .withBean(TripWatchFacade::class.java, Supplier { mockk<TripWatchFacade>(relaxed = true) })
        .withBean(ItineraryFacade::class.java, Supplier { mockk<ItineraryFacade>(relaxed = true) })
        .withBean(ItineraryPlanFacade::class.java, Supplier { mockk<ItineraryPlanFacade>(relaxed = true) })
        .withBean(TriggerService::class.java, Supplier { mockk<TriggerService>(relaxed = true) })
        .withBean(PlanBTriggerRepository::class.java, Supplier { mockk<PlanBTriggerRepository>(relaxed = true) })
        .withBean(PlanBWatchRepository::class.java, Supplier { mockk<PlanBWatchRepository>(relaxed = true) })
        .withBean(Clock::class.java, Supplier { Clock.systemUTC() })
        .withPropertyValues(
            "trippilot.planb.situation-sweep.mode=on",
            // 운영 yml 과 같은 목록 — 기본값(코드)도 같지만 배포 설정 그대로 조립한다.
            "trippilot.planb.situation-sweep.observe-only=kma-warning,airkorea",
        )

    "실 기상청(kma)이면 두 감지기가 live 지만 관찰 전용이라 감시 중이 아니다 — 기동 줄이 둘을 관찰 전용으로 말한다" {
        runner().withPropertyValues("trippilot.weather.mode=kma", "trippilot.weather.service-key=test-key").run { ctx ->
            ctx.getBean(KmaWarningDetector::class.java).isLive() shouldBe true
            ctx.getBean(AirQualityDetector::class.java).isLive() shouldBe true
            val watching = ctx.getBean(WatchingSources::class.java)
            watching.isWatching(SweepSource.KMA_WARNING, anyone) shouldBe false
            watching.isWatching(SweepSource.AIRKOREA, anyone) shouldBe false
            ctx.getBean(SituationSweep::class.java).announcement().let {
                it shouldContain "감지기 live=[airkorea,kma-warning]"
                it shouldContain "관찰 전용=[airkorea,kma-warning]"
            }
        }
    }

    "관찰 전용 목록에서 빼면(켜기) 감시 중이 된다" {
        runner().withPropertyValues(
            "trippilot.weather.mode=kma", "trippilot.weather.service-key=test-key", "trippilot.planb.situation-sweep.observe-only=",
        ).run { ctx ->
            val watching = ctx.getBean(WatchingSources::class.java)
            watching.isWatching(SweepSource.KMA_WARNING, anyone) shouldBe true
            watching.isWatching(SweepSource.AIRKOREA, anyone) shouldBe true
        }
    }

    "가짜 날씨(fake)면 두 감지기 빈이 있어도 live 가 아니다 — 부르지 않고 꺼짐으로 보인다" {
        runner().withPropertyValues("trippilot.weather.mode=fake").run { ctx ->
            ctx.getBean(KmaWarningDetector::class.java).isLive() shouldBe false
            ctx.getBean(AirQualityDetector::class.java).isLive() shouldBe false
            ctx.getBean(SituationSweep::class.java).announcement() shouldContain "감지기 live=[]"
        }
    }
})
