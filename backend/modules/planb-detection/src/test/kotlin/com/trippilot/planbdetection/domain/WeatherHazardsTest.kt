package com.trippilot.planbdetection.domain

import com.trippilot.planbdetection.domain.WeatherHazards.Verdict
import com.trippilot.weathercontext.api.DailyWeather
import com.trippilot.weathercontext.api.HourlyWeather
import com.trippilot.weathercontext.api.PointForecast
import com.trippilot.weathercontext.api.Precipitation
import com.trippilot.weathercontext.api.Sky
import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.collections.shouldBeEmpty
import io.kotest.matchers.shouldBe
import io.kotest.matchers.types.shouldBeInstanceOf
import java.time.Instant
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.LocalTime
import java.time.ZoneId
import java.util.UUID

/**
 * 단기예보 판정 경계 예시(BR-SA-15 표 · 설계서 T-D2-U) — 발화·해제 임계의 양쪽, 실외 집합, 판정 시각, 날짜 집계.
 * 성질(모름·단조·이력)은 [WeatherHazardsPropertyTest] 가 본다.
 */
class WeatherHazardsTest : StringSpec({

    "판정 시각 — 시작 정시부터 끝을 올린 정시까지, 지금 정시 이후 ∧ 발표 뒤만" {
        val f = forecastOf(calmDay(), base = kst("2026-10-20T11:00"))
        val slot = exposure("자연", "10:30", "12:15", f)

        WeatherHazards.judgmentHours(slot.copy(forecast = forecastOf(calmDay())), kst("2026-10-20T09:20")) shouldBe
            listOf(at("10:00"), at("11:00"), at("12:00"), at("13:00"))
        WeatherHazards.judgmentHours(slot, kst("2026-10-20T11:20")) shouldBe listOf(at("12:00"), at("13:00")) // 11시 발표 뒤만
        WeatherHazards.judgmentHours(slot.copy(forecast = null), kst("2026-10-20T11:20")) shouldBe
            listOf(at("11:00"), at("12:00"), at("13:00")) // 예보를 모르면 지금만으로 자른다
    }

    "판정 시각은 자정을 넘긴다 — 22시~01시 슬롯은 다음 날 00·01시까지" {
        val slot = exposure("야경", "22:00", "01:00", forecastOf(calmDay()), endsNextDay = true)

        WeatherHazards.judgmentHours(slot, kst("2026-10-20T09:20")) shouldBe
            listOf(at("22:00"), at("23:00"), LocalDateTime.parse("2026-10-21T00:00"), LocalDateTime.parse("2026-10-21T01:00"))
    }

    "실외는 자연·야경·액티비티뿐이다 — 카테고리가 없으면 판정하지 않는다" {
        WeatherHazards.OUTDOOR shouldBe setOf("자연", "야경", "액티비티")
        listOf("명소", "맛집", "카페", "쇼핑", "문화", null).forEach { WeatherHazards.isOutdoor(it) shouldBe false }

        // 실내·중립·미분류 슬롯에 폭우가 와도 신호가 없다 — 남은 실외 슬롯 0개 = 확인
        val storm = forecastOf(day { it.copy(pop = 100, precipitation = Precipitation.RAIN, wsd = 20.0) })
        judge(exposure("카페", "14:00", "15:00", storm), exposure(null, "14:00", "15:00", storm)) shouldBe Verdict.Clear
    }

    "RAIN — PTY 없음 ∧ POP 59 는 사이, 60 은 발화, 49 는 해제" {
        judgeCalmWith { it.copy(pop = 59) } shouldBe Verdict.Unsettled
        judgeCalmWith { it.copy(pop = 60) }.hazard().variant shouldBe TriggerVariant.RAIN
        judgeCalmWith { it.copy(pop = 50) } shouldBe Verdict.Unsettled
        judgeCalmWith { it.copy(pop = 49) } shouldBe Verdict.Clear
    }

    "RAIN — PTY 비·소나기면 POP 와 무관하게 발화한다" {
        judgeCalmWith { it.copy(pop = 30, precipitation = Precipitation.RAIN) }.hazard().variant shouldBe TriggerVariant.RAIN
        judgeCalmWith { it.copy(pop = 30, precipitation = Precipitation.SHOWER) }.hazard().variant shouldBe TriggerVariant.RAIN
    }

    "SNOW — PTY 눈·비/눈이면 발화하고 비보다 앞선다" {
        judgeCalmWith { it.copy(precipitation = Precipitation.SNOW) }.hazard().variants shouldBe listOf(TriggerVariant.SNOW)
        val sleet = judgeCalmWith { it.copy(pop = 90, precipitation = Precipitation.RAIN_SNOW) }.hazard()
        sleet.variant shouldBe TriggerVariant.SNOW
        sleet.severity shouldBe TriggerSeverity.RISK
    }

    "WIND — 13.9 는 사이, 14.0 은 발화, 11.9 는 해제" {
        judgeCalmWith { it.copy(wsd = 13.9) } shouldBe Verdict.Unsettled
        judgeCalmWith { it.copy(wsd = 14.0) }.hazard().let {
            it.variant shouldBe TriggerVariant.WIND
            it.evidence.windMax shouldBe 14.0
        }
        judgeCalmWith { it.copy(wsd = 11.9) } shouldBe Verdict.Clear
    }

    "HEAT — 12~17시와 겹친 슬롯만, 32.9 사이 · 33.0 주의 · 35.0 위험 · 30.9 해제" {
        judgeCalmWith(start = "13:00", end = "15:00") { it.copy(tmp = 32.9) } shouldBe Verdict.Unsettled
        judgeCalmWith(start = "13:00", end = "15:00") { it.copy(tmp = 33.0) }.hazard().let {
            it.variant shouldBe TriggerVariant.HEAT
            it.severity shouldBe TriggerSeverity.CAUTION
            it.evidence.tempMax shouldBe 33.0
        }
        judgeCalmWith(start = "13:00", end = "15:00") { it.copy(tmp = 35.0) }.hazard().severity shouldBe TriggerSeverity.RISK
        judgeCalmWith(start = "13:00", end = "15:00") { it.copy(tmp = 30.9) } shouldBe Verdict.Clear
        // 오전 슬롯은 한낮과 겹치지 않는다 — 더워도 HEAT 가 아니다
        judgeCalmWith(start = "09:00", end = "10:00") { it.copy(tmp = 36.0) } shouldBe Verdict.Clear
    }

    "HEAT — 한낮 슬롯이면 그 날 최고(TMX)도 본다" {
        val f = forecastOf(calmDay(), daily = mapOf(DAY to DailyWeather(tmn = 15.0, tmx = 35.0)))
        judge(exposure("자연", "13:00", "14:00", f)).hazard().let {
            it.variant shouldBe TriggerVariant.HEAT
            it.severity shouldBe TriggerSeverity.RISK
        }
    }

    "COLD — -11.9 사이 · -12.0 발화 · -9.9 해제, 최저(TMN)가 -12 면 그 날 실외 전부" {
        judgeCalmWith { it.copy(tmp = -11.9) } shouldBe Verdict.Unsettled
        judgeCalmWith { it.copy(tmp = -12.0) }.hazard().let {
            it.variant shouldBe TriggerVariant.COLD
            it.evidence.tempMin shouldBe -12.0
        }
        judgeCalmWith { it.copy(tmp = -9.9) } shouldBe Verdict.Clear

        val frost = forecastOf(calmDay(), daily = mapOf(DAY to DailyWeather(tmn = -12.0, tmx = 2.0)))
        val cold = judge(exposure("자연", "10:00", "11:00", frost), exposure("액티비티", "15:00", "16:00", frost)).hazard()
        cold.variant shouldBe TriggerVariant.COLD
        cold.affected.size shouldBe 2
    }

    "CLOUD — 야경 슬롯 시각 과반이 흐림 ∧ 강수 없음이면 주의, 1/3 이하면 해제, 그 사이는 사이" {
        // 19·20·21시 세 시각 중 둘이 흐림 → 과반 → 주의
        val two = forecastOf(calmDay { h, w -> if (h.hour in 19..20) w.copy(sky = Sky.OVERCAST) else w })
        judge(exposure("야경", "19:00", "21:00", two)).hazard().let {
            it.variant shouldBe TriggerVariant.CLOUD
            it.severity shouldBe TriggerSeverity.CAUTION
        }
        // 셋 중 하나 → 1/3 → 해제
        val one = forecastOf(calmDay { h, w -> if (h.hour == 19) w.copy(sky = Sky.OVERCAST) else w })
        judge(exposure("야경", "19:00", "21:00", one)) shouldBe Verdict.Clear
        // 18~21시 네 시각 중 둘 → 과반 아님 ∧ 1/3 초과 → 사이
        val half = forecastOf(calmDay { h, w -> if (h.hour in 18..19) w.copy(sky = Sky.OVERCAST) else w })
        judge(exposure("야경", "18:00", "21:00", half)) shouldBe Verdict.Unsettled
        // 자연 슬롯은 흐려도 CLOUD 가 아니다
        val gray = forecastOf(calmDay { _, w -> w.copy(sky = Sky.OVERCAST) })
        judge(exposure("자연", "19:00", "21:00", gray)) shouldBe Verdict.Clear
    }

    "CLOUD — 흐리고 비가 오면 비다(흐림은 강수 없음일 때만)" {
        val wet = forecastOf(calmDay { _, w -> w.copy(sky = Sky.OVERCAST, precipitation = Precipitation.RAIN) })
        judge(exposure("야경", "19:00", "21:00", wet)).hazard().variants shouldBe listOf(TriggerVariant.RAIN)
    }

    "대표 = 심각도 → SNOW > RAIN > WIND > COLD > HEAT > CLOUD, 위험이 하나라도 있으면 위험" {
        val rainAndHeat = forecastOf(calmDay { h, w -> if (h.hour == 13) w.copy(tmp = 34.0, pop = 70) else w })
        judge(exposure("자연", "13:00", "14:00", rainAndHeat)).hazard().let {
            it.severity shouldBe TriggerSeverity.RISK
            it.variant shouldBe TriggerVariant.RAIN
            it.variants shouldBe listOf(TriggerVariant.RAIN, TriggerVariant.HEAT)
        }
        val heatAndCloud = forecastOf(calmDay { _, w -> w.copy(tmp = 33.5, sky = Sky.OVERCAST) })
        judge(exposure("야경", "15:00", "17:00", heatAndCloud)).hazard().let {
            it.severity shouldBe TriggerSeverity.CAUTION
            it.variant shouldBe TriggerVariant.HEAT
            it.variants shouldBe listOf(TriggerVariant.HEAT, TriggerVariant.CLOUD)
        }
        val coldAndHot = forecastOf(calmDay { h, w -> if (h.hour == 13) w.copy(tmp = 36.0) else w.copy(tmp = -13.0) })
        judge(exposure("자연", "11:00", "13:00", coldAndHot)).hazard().variant shouldBe TriggerVariant.COLD
        val windAndCold = forecastOf(calmDay { _, w -> w.copy(wsd = 15.0, tmp = -13.0) })
        judge(exposure("자연", "10:00", "11:00", windAndCold)).hazard().variant shouldBe TriggerVariant.WIND
    }

    "모르는 칸이 섞여 신호가 없으면 모름이다 — 다른 슬롯에 신호가 있으면 발화한다" {
        val holey = forecastOf(calmDay { h, w -> if (h.hour == 15) w.copy(wsd = null) else w })
        judge(exposure("자연", "14:00", "16:00", holey)) shouldBe Verdict.Unknown
        judge(exposure("자연", "14:00", "16:00", null)) shouldBe Verdict.Unknown
        val missingHour = PointForecast("53,38", BASE, calmDay().filterKeys { it.hour != 15 }, emptyMap())
        judge(exposure("자연", "14:00", "16:00", missingHour)) shouldBe Verdict.Unknown

        val rainy = forecastOf(day { it.copy(precipitation = Precipitation.RAIN) })
        val mixed = judge(exposure("자연", "14:00", "16:00", holey), exposure("액티비티", "10:00", "11:00", rainy, name = "우도")).hazard()
        mixed.variant shouldBe TriggerVariant.RAIN
        mixed.affected.map { it.name } shouldBe listOf("우도")
        mixed.remaining shouldBe 2
    }

    "야경은 하늘상태도 판정 재료다 — 야경 슬롯의 SKY 를 모르면 모름, 자연 슬롯은 상관없다" {
        val skyless = forecastOf(calmDay { _, w -> w.copy(sky = null) })
        judge(exposure("야경", "19:00", "20:00", skyless)) shouldBe Verdict.Unknown
        judge(exposure("자연", "19:00", "20:00", skyless)) shouldBe Verdict.Clear
    }

    "남은 실외 슬롯이 없으면 확인이다 — 실내로 바꾼 날은 해제된다" {
        judge() shouldBe Verdict.Clear
        judge(exposure("문화", "14:00", "15:00", null)) shouldBe Verdict.Clear
    }

    "coverage — 영향 × 2 ≥ 남은 실외면 MOST, 아니면 SOME" {
        val rainAfternoon = forecastOf(calmDay { h, w -> if (h.hour in 14..16) w.copy(precipitation = Precipitation.RAIN) else w })
        judge(
            exposure("자연", "14:00", "15:00", rainAfternoon),
            exposure("자연", "09:00", "10:00", rainAfternoon),
            exposure("자연", "11:00", "12:00", rainAfternoon),
        ).hazard().coverage shouldBe WeatherHazards.Coverage.SOME // 1 / 3
        judge(
            exposure("자연", "14:00", "15:00", rainAfternoon),
            exposure("자연", "09:00", "10:00", rainAfternoon),
        ).hazard().coverage shouldBe WeatherHazards.Coverage.MOST // 1 / 2
    }

    "영향 슬롯은 시작 순이고, 근거 시각·발표 시각·강수확률 최댓값을 싣는다" {
        val f = forecastOf(calmDay { h, w -> if (h.hour in 13..14) w.copy(pop = if (h.hour == 13) 70 else 80) else w })
        val late = exposure("자연", "14:00", "15:00", f, name = "성산일출봉")
        val early = exposure("액티비티", "12:00", "13:00", f, name = "우도")

        val h = judge(late, early).hazard()

        h.affected.map { it.name } shouldBe listOf("우도", "성산일출봉")
        h.hours shouldBe listOf(at("13:00"), at("14:00"))
        h.baseAt shouldBe BASE
        h.evidence shouldBe WeatherHazards.Evidence(popMax = 80, windMax = null, tempMax = null, tempMin = null)
    }

    "기온 변형은 걸린 시각을 싣지 않는다 — 문구에 시간대를 붙이지 않는다" {
        judgeCalmWith(start = "13:00", end = "15:00") { it.copy(tmp = 35.5) }.hazard().hours.shouldBeEmpty()
    }

    "발표 시각 이전 칸은 판정하지 않는다 — 지난 시각이 없다고 모름으로 읽지 않는다" {
        // 11시 발표분에는 11시 이전 칸이 없다. 10~12시 슬롯은 12시만 본다.
        val f = PointForecast("53,38", kst("2026-10-20T11:00"), mapOf(at("12:00") to CALM), emptyMap())
        judge(exposure("자연", "10:00", "12:00", f), now = kst("2026-10-20T11:20")) shouldBe Verdict.Clear
    }
}) {
    companion object {
        val DAY: LocalDate = LocalDate.parse("2026-10-20")
        private val ZONE: ZoneId = ZoneId.of("Asia/Seoul")
        val BASE: Instant = kst("2026-10-20T08:00")
        val NOW: Instant = kst("2026-10-20T09:20")

        /** 평온한 한 시각 — 어느 변형도 해제 임계 아래다. */
        val CALM = HourlyWeather(pop = 10, precipitation = Precipitation.NONE, sky = Sky.CLEAR, tmp = 20.0, wsd = 2.0)

        fun kst(local: String): Instant = LocalDateTime.parse(local).atZone(ZONE).toInstant()
        fun at(hhmm: String): LocalDateTime = DAY.atTime(LocalTime.parse(hhmm))

        /** 그 날·다음 날 0~23시 전부 — [edit] 으로 시각마다 고친다. */
        fun calmDay(edit: (LocalDateTime, HourlyWeather) -> HourlyWeather = { _, w -> w }): Map<LocalDateTime, HourlyWeather> =
            (0L..47L).map { DAY.atStartOfDay().plusHours(it) }.associateWith { edit(it, CALM) }

        fun day(edit: (HourlyWeather) -> HourlyWeather) = calmDay { _, w -> edit(w) }

        fun forecastOf(
            hourly: Map<LocalDateTime, HourlyWeather>,
            base: Instant = BASE,
            daily: Map<LocalDate, DailyWeather> = emptyMap(),
        ) = PointForecast("53,38", base, hourly.filterKeys { it.atZone(ZONE).toInstant() > base }, daily)

        fun exposure(
            category: String?, start: String, end: String, forecast: PointForecast?,
            name: String? = "성산일출봉", endsNextDay: Boolean = false,
        ): WeatherHazards.Exposure {
            val poi = UUID.randomUUID()
            return WeatherHazards.Exposure(
                "$DAY#$poi", poi, name, category, DAY, LocalTime.parse(start), LocalTime.parse(end), endsNextDay, forecast,
            )
        }

        fun judge(vararg exposures: WeatherHazards.Exposure, now: Instant = NOW) = WeatherHazards.judge(exposures.toList(), now)

        /** 자연 슬롯 하나(기본 14~16시)의 모든 시각을 [edit] 으로 바꾼 판정. */
        fun judgeCalmWith(start: String = "14:00", end: String = "16:00", edit: (HourlyWeather) -> HourlyWeather) =
            judge(exposure("자연", start, end, forecastOf(day(edit))))

        fun Verdict.hazard(): Verdict.Hazard = this.shouldBeInstanceOf<Verdict.Hazard>()
    }
}
