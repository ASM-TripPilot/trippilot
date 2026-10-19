package com.trippilot.planbdetection.domain

import com.trippilot.planbdetection.domain.WeatherHazards.Exposure
import com.trippilot.planbdetection.domain.WeatherHazards.Verdict
import com.trippilot.weathercontext.api.DailyWeather
import com.trippilot.weathercontext.api.HourlyWeather
import com.trippilot.weathercontext.api.PointForecast
import com.trippilot.weathercontext.api.Precipitation
import com.trippilot.weathercontext.api.Sky
import io.kotest.assertions.withClue
import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.collections.shouldContain
import io.kotest.matchers.shouldBe
import io.kotest.matchers.shouldNotBe
import io.kotest.property.Arb
import io.kotest.property.RandomSource
import io.kotest.property.arbitrary.arbitrary
import io.kotest.property.arbitrary.double
import io.kotest.property.arbitrary.element
import io.kotest.property.arbitrary.int
import io.kotest.property.arbitrary.shuffle
import io.kotest.property.checkAll
import java.time.Instant
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.LocalTime
import java.time.ZoneId
import java.util.UUID

/**
 * 단기예보 판정 PBT(블로킹 게이트 PBT-SA-09·10·11 · 설계서 T-D2-P1~P3).
 *
 * - **P09 모름은 절대 해제가 아니다** — 확인(Clear) ⇒ 남은 실외 슬롯의 판정 시각 값이 다 있고 해제 임계 아래. 확인된 상황에서
 *   필요한 칸 하나만 지워도 확인이 아니게 된다.
 * - **P10 단조성·무관 입력** — POP·WSD·기온을 올려도 RAIN·WIND·HEAT 는, 기온을 내려도 COLD 는 남는다. 실내·중립 슬롯의 예보를
 *   바꿔도, 슬롯 순서를 섞어도 판정이 같다.
 * - **P11 이력 현상** — 발화와 해제 임계 사이 값은 신호도 확인도 만들지 않는다. 위험 변형이 하나라도 있으면 위험이다.
 *
 * 오라클은 정본 표(BR-SA-15)의 수치를 그대로 적는다 — 구현의 판정 함수를 다시 부르지 않는다.
 */
class WeatherHazardsPropertyTest : StringSpec({

    "P09 확인이면 남은 실외 슬롯의 판정 시각 값이 다 있고 전부 해제 임계 아래다" {
        checkAll(situations) { s ->
            if (WeatherHazards.judge(s.exposures, s.now) == Verdict.Clear) {
                for (e in s.exposures.filter { it.category in OUTDOOR }) {
                    val hours = WeatherHazards.judgmentHours(e, s.now)
                    if (hours.isEmpty()) continue
                    withClue("확인인데 예보가 없는 실외 슬롯 $e") { (e.forecast != null) shouldBe true }
                    for (h in hours) withClue("확인인데 해제 아래가 아닌 칸 $h ${e.forecast!!.hourly[h]}") {
                        releasedAt(e, h) shouldBe true
                    }
                    if (e.category == WeatherHazards.NIGHT_VIEW) withClue("확인인데 야경 시각의 1/3 넘게 흐리다") {
                        (hours.count { e.forecast!!.hourly[it]?.sky == Sky.OVERCAST } * 3 <= hours.size) shouldBe true
                    }
                }
            }
        }
    }

    "P09 확인된 상황에서 필요한 칸 하나를 지우면 모름이 된다 — 모름으로 확인이 생기지 않는다" {
        checkAll(situations, Arb.int(0, 1_000_000)) { s, pick ->
            val before = WeatherHazards.judge(s.exposures, s.now)
            val holes = s.exposures.withIndex().filter { (_, e) -> e.category in OUTDOOR }
                .flatMap { (i, e) -> WeatherHazards.judgmentHours(e, s.now).map { i to it } }
            if (before == Verdict.Clear && holes.isNotEmpty()) {
                val (i, h) = holes[pick % holes.size]
                val e = s.exposures[i]
                val needed = if (e.category == WeatherHazards.NIGHT_VIEW) FIELDS + "sky" else FIELDS
                val punched = e.copy(forecast = e.forecast!!.erase(h, needed[pick % needed.size]))
                val after = WeatherHazards.judge(s.exposures.toMutableList().also { it[i] = punched }, s.now)
                withClue("$h 의 ${needed[pick % needed.size]} 를 지웠다") { after shouldBe Verdict.Unknown }
            }
        }
    }

    "P10 단조성 — POP·WSD·기온을 올려도 RAIN·WIND·HEAT 는, 기온을 내려도 COLD 는 남는다" {
        checkAll(situations, Arb.int(0, 40), Arb.double(0.0, 10.0), Arb.double(0.0, 15.0)) { s, dPop, dWind, dTemp ->
            val before = WeatherHazards.judge(s.exposures, s.now) as? Verdict.Hazard ?: return@checkAll
            val up = WeatherHazards.judge(s.exposures.map { it.mapForecast { f -> f.shift(dPop, dWind, dTemp) } }, s.now)
            val down = WeatherHazards.judge(s.exposures.map { it.mapForecast { f -> f.shift(0, 0.0, -dTemp) } }, s.now)
            for (v in listOf(TriggerVariant.RAIN, TriggerVariant.WIND, TriggerVariant.HEAT).filter { it in before.variants }) {
                withClue("$v 가 올린 뒤 사라졌다") { (up as Verdict.Hazard).variants shouldContain v }
            }
            if (TriggerVariant.COLD in before.variants) {
                withClue("COLD 가 내린 뒤 사라졌다") { (down as Verdict.Hazard).variants shouldContain TriggerVariant.COLD }
            }
        }
    }

    "P10 실내·중립·미분류 슬롯의 예보를 바꿔도, 슬롯 순서를 섞어도 판정이 같다" {
        checkAll(situations, Arb.int(0, 1_000_000)) { s, seed ->
            val before = WeatherHazards.judge(s.exposures, s.now)
            val rs = RandomSource.seeded(seed.toLong())
            val repainted = s.exposures.map { e ->
                if (e.category in OUTDOOR) e else e.copy(forecast = forecastArb(s.base, wild = true).sample(rs).value)
            }
            WeatherHazards.judge(repainted, s.now) shouldBe before
            WeatherHazards.judge(Arb.shuffle(s.exposures).sample(rs).value, s.now) shouldBe before
        }
    }

    "P11 발화와 해제 임계 사이 값은 신호도 확인도 아니다" {
        checkAll(bands) { s ->
            withClue("띠 ${s.band}") { WeatherHazards.judge(s.exposures, s.now) shouldBe Verdict.Unsettled }
        }
    }

    "P11 위험 변형이 하나라도 있으면 위험이고, 주의는 HEAT·CLOUD 뿐이다" {
        checkAll(situations) { s ->
            val h = WeatherHazards.judge(s.exposures, s.now) as? Verdict.Hazard ?: return@checkAll
            if (h.variants.any { it in ALWAYS_RISK }) h.severity shouldBe TriggerSeverity.RISK
            if (h.severity == TriggerSeverity.CAUTION) h.variants.all { it == TriggerVariant.HEAT || it == TriggerVariant.CLOUD } shouldBe true
            h.affected.isEmpty() shouldNotBe true
        }
    }
})

// ── 생성기 ──

private val ZONE: ZoneId = ZoneId.of("Asia/Seoul")
private val DAY: LocalDate = LocalDate.parse("2026-10-20")
private val OUTDOOR = WeatherHazards.OUTDOOR
private val CATEGORIES = listOf("자연", "야경", "액티비티", "명소", "맛집", "카페", "쇼핑", "문화", null)
private val ALWAYS_RISK = setOf(TriggerVariant.RAIN, TriggerVariant.SNOW, TriggerVariant.WIND, TriggerVariant.COLD)
private val FIELDS = listOf("pop", "precipitation", "tmp", "wsd", "hour")

private data class Situation(val now: Instant, val base: Instant, val exposures: List<Exposure>, val band: String = "")

/** 지금 이전의 가장 최근 발표(02·05·…·23시, 제공 지연 10분). */
private fun baseAt(now: Instant): Instant {
    val lagged = LocalDateTime.ofInstant(now, ZONE).minusMinutes(10)
    val hour = listOf(2, 5, 8, 11, 14, 17, 20, 23).last { it <= lagged.hour }
    return lagged.toLocalDate().atTime(hour, 0).atZone(ZONE).toInstant()
}

/** 회차 시각 — 그 날 07~20시(오늘을 본다) 또는 전날 20시대(저녁 회차가 내일을 본다). */
private val nowArb: Arb<Instant> = arbitrary {
    val local = if (Arb.int(0, 3).bind() == 0) {
        DAY.minusDays(1).atTime(20, Arb.int(0, 59).bind())
    } else {
        DAY.atTime(Arb.int(7, 20).bind(), Arb.int(0, 59).bind())
    }
    local.atZone(ZONE).toInstant()
}

/** 평온(모든 변형 해제 아래)과 거친 값(무엇이든)을 섞는다 — 확인과 발화가 둘 다 자주 나오게. */
private fun hourArb(wild: Boolean): Arb<HourlyWeather> = arbitrary {
    if (!wild) {
        HourlyWeather(
            pop = Arb.int(0, 40).bind(), precipitation = Precipitation.NONE,
            sky = Arb.element(Sky.CLEAR, Sky.MOSTLY_CLOUDY).bind(),
            tmp = Arb.double(-5.0, 28.0).bind(), wsd = Arb.double(0.0, 10.0).bind(),
        )
    } else {
        HourlyWeather(
            pop = Arb.int(0, 100).bind(), precipitation = Arb.element(Precipitation.entries).bind(),
            sky = Arb.element(Sky.entries).bind(), tmp = Arb.double(-20.0, 40.0).bind(), wsd = Arb.double(0.0, 20.0).bind(),
        )
    }
}

/** 한 격자 예보 — 발표 뒤 그 날·다음 날 정시 전부. 거친 격자는 칸을 가끔 지운다(모름). */
private fun forecastArb(base: Instant, wild: Boolean): Arb<PointForecast> = arbitrary {
    val hours = (0L..47L).map { DAY.atStartOfDay().plusHours(it) }.filter { it.atZone(ZONE).toInstant() > base }
    val holes = wild && Arb.int(0, 2).bind() == 0
    val grayEvening = !wild && Arb.int(0, 3).bind() == 0 // 평온하지만 저녁이 흐린 날 — 야경 흐림(CLOUD)이 나오게
    val hourly = LinkedHashMap<LocalDateTime, HourlyWeather>()
    for (h in hours) {
        var w = hourArb(wild = wild && Arb.int(0, 3).bind() != 0).bind()
        if (grayEvening && h.hour in 18..23) w = w.copy(sky = Sky.OVERCAST)
        if (holes && Arb.int(0, 30).bind() == 0) {
            when (Arb.int(0, 5).bind()) {
                0 -> continue // 시각 통째로 없음
                1 -> w = w.copy(pop = null)
                2 -> w = w.copy(precipitation = null)
                3 -> w = w.copy(sky = null)
                4 -> w = w.copy(tmp = null)
                else -> w = w.copy(wsd = null)
            }
        }
        hourly[h] = w
    }
    val daily = listOf(DAY, DAY.plusDays(1)).associateWith {
        if (wild) DailyWeather(Arb.double(-20.0, 10.0).bind(), Arb.double(15.0, 40.0).bind()) else DailyWeather(-4.0, 27.0)
    }.filter { Arb.int(0, 2).bind() != 0 }
    PointForecast("53,38", base, hourly, daily)
}

private fun exposureArb(forecasts: List<PointForecast?>): Arb<Exposure> = arbitrary {
    val start = LocalTime.of(Arb.int(6, 22).bind(), Arb.element(0, 30).bind())
    val end = start.plusHours(Arb.int(1, 3).bind().toLong())
    val poi = UUID.randomUUID()
    Exposure(
        "$DAY#$poi", poi, Arb.element("성산일출봉", "우도", "365분식", null).bind(), Arb.element(CATEGORIES).bind(),
        DAY, start, end, endsNextDay = end < start, forecast = Arb.element(forecasts).bind(),
    )
}

private val situations: Arb<Situation> = arbitrary {
    val now = nowArb.bind()
    val base = baseAt(now)
    val grids = List(Arb.int(1, 3).bind()) { forecastArb(base, wild = Arb.int(0, 4).bind() < 2).bind() }
    val forecasts: List<PointForecast?> = if (Arb.int(0, 9).bind() == 0) grids + null else grids
    Situation(now, base, List(Arb.int(0, 5).bind()) { exposureArb(forecasts).bind() })
}

/**
 * 이력 띠 — 한 변형만 '발화와 해제 사이'에 두고 나머지는 평온, 칸은 다 있다. 회차는 이른 아침이라 모든 슬롯이 남았다.
 * HEAT 는 한낮과 겹친 슬롯, CLOUD 는 네 시각 중 둘이 흐린 야경 슬롯으로 띠를 만든다.
 */
private val bands: Arb<Situation> = arbitrary {
    val now = DAY.atTime(7, Arb.int(15, 59).bind()).atZone(ZONE).toInstant()
    val base = baseAt(now)
    val band = Arb.element("RAIN", "WIND", "HEAT", "COLD", "CLOUD").bind()
    val hours = (0L..47L).map { DAY.atStartOfDay().plusHours(it) }.filter { it.atZone(ZONE).toInstant() > base }
    val calm = HourlyWeather(20, Precipitation.NONE, Sky.CLEAR, 20.0, 3.0)
    val hourly = hours.associateWith { h ->
        when (band) {
            "RAIN" -> calm.copy(pop = Arb.int(50, 59).bind())
            "WIND" -> calm.copy(wsd = Arb.double(12.0, 13.99).bind())
            "HEAT" -> calm.copy(tmp = Arb.double(31.0, 32.99).bind())
            "COLD" -> calm.copy(tmp = Arb.double(-11.99, -10.0).bind())
            else -> if (h.hour in 18..19) calm.copy(sky = Sky.OVERCAST) else calm
        }
    }
    val daily = when (band) {
        "HEAT" -> mapOf(DAY to DailyWeather(tmn = 25.0, tmx = Arb.double(31.0, 32.99).bind()))
        "COLD" -> mapOf(DAY to DailyWeather(tmn = Arb.double(-11.99, -10.0).bind(), tmx = -10.0))
        else -> emptyMap()
    }
    val f = PointForecast("53,38", base, hourly, daily)
    fun slot(category: String, start: Int, end: Int) = UUID.randomUUID().let {
        Exposure("$DAY#$it", it, "우도", category, DAY, LocalTime.of(start, 0), LocalTime.of(end, 0), false, f)
    }
    val exposures = when (band) {
        "HEAT" -> List(Arb.int(1, 3).bind()) { slot(Arb.element("자연", "액티비티").bind(), Arb.int(12, 15).bind(), 16) }
        "CLOUD" -> listOf(slot("야경", 18, 21)) + List(Arb.int(0, 2).bind()) { slot("자연", Arb.int(9, 15).bind(), 17) }
        else -> List(Arb.int(1, 3).bind()) { slot(Arb.element(OUTDOOR.toList()).bind(), Arb.int(8, 20).bind(), 21) }
    }
    Situation(now, base, exposures + slot("카페", 13, 14), band)
}

// ── 오라클 — 정본 표(BR-SA-15)의 해제 임계를 그대로 적는다 ──

/** 그 시각에서 그 슬롯이 모든 변형의 해제 임계 아래인가(칸이 다 있어야 한다). */
private fun releasedAt(e: Exposure, h: LocalDateTime): Boolean {
    val w = e.forecast?.hourly?.get(h) ?: return false
    val pop = w.pop ?: return false
    val tmp = w.tmp ?: return false
    val wsd = w.wsd ?: return false
    if (w.precipitation != Precipitation.NONE || pop >= 50 || wsd >= 12.0 || tmp <= -10.0) return false
    if (h.hour in 12..17 && tmp >= 31.0) return false
    val tmn = e.forecast.daily[h.toLocalDate()]?.tmn
    val tmx = e.forecast.daily[h.toLocalDate()]?.tmx
    if (tmn != null && tmn <= -10.0) return false
    if (h.hour in 12..17 && tmx != null && tmx >= 31.0) return false
    if (e.category == WeatherHazards.NIGHT_VIEW && w.sky == null) return false
    return true
}

/** 한 시각의 한 칸을 지운다("hour" 면 시각 통째로). 다른 슬롯과 나눠 쓰는 격자를 건드리지 않게 새 예보를 만든다. */
private fun PointForecast.erase(h: LocalDateTime, field: String): PointForecast {
    val w = hourly.getValue(h)
    val next = when (field) {
        "pop" -> w.copy(pop = null)
        "precipitation" -> w.copy(precipitation = null)
        "tmp" -> w.copy(tmp = null)
        "wsd" -> w.copy(wsd = null)
        "sky" -> w.copy(sky = null)
        else -> null
    }
    return copy(hourly = if (next == null) hourly - h else hourly + (h to next))
}

private fun Exposure.mapForecast(edit: (PointForecast) -> PointForecast) = copy(forecast = forecast?.let(edit))

/** POP·WSD 를 올리고 기온(TMP·TMN·TMX)을 [dTemp] 만큼 옮긴다. */
private fun PointForecast.shift(dPop: Int, dWind: Double, dTemp: Double) = copy(
    hourly = hourly.mapValues { (_, w) ->
        w.copy(pop = w.pop?.let { minOf(100, it + dPop) }, wsd = w.wsd?.plus(dWind), tmp = w.tmp?.plus(dTemp))
    },
    daily = daily.mapValues { (_, d) -> DailyWeather(d.tmn?.plus(dTemp), d.tmx?.plus(dTemp)) },
)
