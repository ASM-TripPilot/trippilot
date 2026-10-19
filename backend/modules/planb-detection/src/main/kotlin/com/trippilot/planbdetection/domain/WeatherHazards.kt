package com.trippilot.planbdetection.domain

import com.trippilot.weathercontext.api.HourlyWeather
import com.trippilot.weathercontext.api.PointForecast
import com.trippilot.weathercontext.api.Precipitation
import com.trippilot.weathercontext.api.Sky
import java.time.Instant
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.LocalTime
import java.time.ZoneId
import java.time.temporal.ChronoUnit
import java.util.UUID

/**
 * 단기예보 발화·해제 임계(BR-SA-15 표 — C9 소유 상수). **두 임계 사이 값은 발화도 해제도 아니다**(이력 현상 — 상태를 저장하지 않는다).
 *
 * 발화 수치는 G-U4-2(강수 60 — 백엔드 발화 정본, 날씨 확인 `WeatherTriggerService` 와 같은 값. AI 생성 파이프라인의 80 과 맞추지 않는다)와
 * 기상청 특보 기준의 근사(강풍 14m/s · 폭염 체감 33/35℃ · 한파 −12℃)다 — **특보 판정이 아니다**(문구에 '주의보'·'경보'를 쓰지 않는다).
 * 해제 수치는 관측 뒤 조정하는 초기값이다.
 */
object WeatherThresholds {
    /** RAIN — PTY 없음 ∧ POP ≥ 60 발화, PTY 없음 ∧ POP < 50 해제. */
    const val RAIN_POP = 60
    const val RAIN_POP_CLEAR = 50

    /** WIND — WSD ≥ 14 발화, < 12 해제. */
    const val WIND_MS = 14.0
    const val WIND_MS_CLEAR = 12.0

    /** HEAT — 12~17시와 겹친 슬롯의 TMP·TMX 최고 ≥ 33 주의 · ≥ 35 위험(O-SA-2), < 31 해제. */
    const val HEAT_CAUTION_C = 33.0
    const val HEAT_RISK_C = 35.0
    const val HEAT_CLEAR_C = 31.0
    val HEAT_HOURS: IntRange = 12..17

    /** COLD — TMN 또는 TMP 최저 ≤ −12 발화, > −10 해제. */
    const val COLD_C = -12.0
    const val COLD_CLEAR_C = -10.0
}

/**
 * 단기예보로 본 실외 슬롯의 날씨 위험 — 순수 판정(BR-SA-15). 조회·저장을 하지 않는다.
 *
 * 남은 **실외** 슬롯의 판정 시각(시작 정시 ~ 끝을 올린 정시, 자정 넘김 포함 · 지금 정시 이후 ∧ 발표 뒤)마다 변형별 발화·해제 임계를 본다.
 * - 슬롯 하나라도 발화하면 **신호**다(그 날 하나 — 날씨는 날짜 단위). 모르는 슬롯이 섞여도 발화한다.
 * - 남은 실외 슬롯의 판정 시각 값이 **다 있고 전부** 해제 임계 아래면 **확인**이다. 남은 실외 슬롯이 0개여도 확인이다(실내로 바꾼 날).
 * - 그 밖에 모르는 칸이 있으면 **모름**, 없으면(두 임계 사이) **신호도 확인도 아님**이다.
 *
 * 한 시각의 판정 재료는 POP·PTY·TMP·WSD(야경이면 SKY 도)다 — 하나라도 없으면 그 시각은 확인될 수 없다(INV-SA-2).
 */
object WeatherHazards {

    /**
     * 실외 = 재계획 INDOOR·AVOID_OUTDOOR 가 빼는 카테고리 — 경보 대상 = 재계획이 바꾸는 대상이다.
     * 정본: `ai/src/trippilot/assembly_engine/config.py` `RAIN_OUTDOOR` · `ai/data/replan_directives.yaml` INDOOR·AVOID_OUTDOOR 의
     * `avoid_categories`(NATURE·NIGHT_VIEW·ACTIVITY). 여기만 바꾸지 않는다 — 바꿀 때는 저쪽과 한 번에(G-SA-10 · O-SA-5).
     */
    val OUTDOOR: Set<String> = setOf("자연", "야경", "액티비티")

    /** 흐림(CLOUD)은 야경 슬롯만 본다(O-SA-4). */
    const val NIGHT_VIEW = "야경"

    /** 같은 심각도 안의 대표 우선순위. */
    val PRECEDENCE: List<TriggerVariant> = listOf(
        TriggerVariant.SNOW, TriggerVariant.RAIN, TriggerVariant.WIND, TriggerVariant.COLD, TriggerVariant.HEAT, TriggerVariant.CLOUD,
    )

    private val ZONE: ZoneId = ZoneId.of("Asia/Seoul")
    private val RAINY = setOf(Precipitation.RAIN, Precipitation.SHOWER)
    private val SNOWY = setOf(Precipitation.SNOW, Precipitation.RAIN_SNOW)

    /** 판정할 슬롯 하나 — 계획 시각과 그 슬롯 격자의 예보. */
    data class Exposure(
        val slotKey: String,
        val poiId: UUID,
        val name: String?,
        /** 한글 정본 카테고리. null 이면 판정하지 않는다(지어내지 않는다). */
        val category: String?,
        val date: LocalDate,
        val startAt: LocalTime,
        val endAt: LocalTime,
        val endsNextDay: Boolean,
        /** null = 모름(좌표 없음 · 조회 실패 · 자료 없음). */
        val forecast: PointForecast?,
    )

    /** 영향 범위 — 영향 슬롯 × 2 ≥ 남은 실외 슬롯이면 MOST(선계산이 제외 POI 를 쓰지 않는다). */
    enum class Coverage { MOST, SOME }

    /** 근거값 — 발화한 변형의 값만 싣는다(되짚기·문구 재료). */
    data class Evidence(val popMax: Int?, val windMax: Double?, val tempMax: Double?, val tempMin: Double?)

    sealed interface Verdict {
        /**
         * 신호 — 그 날 하나. [variant] = 심각도 → [PRECEDENCE] 로 고른 대표, [variants] = 걸린 변형 전부(우선순위 순),
         * [affected] = 영향 슬롯(시작 순), [remaining] = 남은 실외 슬롯 수, [hours] = 대표 변형이 걸린 시각(기온 변형은 비어 있다),
         * [baseAt] = 영향 슬롯 예보 중 가장 최근 발표.
         */
        data class Hazard(
            val severity: TriggerSeverity,
            val variant: TriggerVariant,
            val variants: List<TriggerVariant>,
            val affected: List<Exposure>,
            val remaining: Int,
            val hours: List<LocalDateTime>,
            val baseAt: Instant,
            val evidence: Evidence,
        ) : Verdict {
            val coverage: Coverage get() = if (affected.size * 2 >= remaining) Coverage.MOST else Coverage.SOME
        }

        /** 확인 — 남은 실외 슬롯의 값이 다 있고 전부 해제 임계 아래(0개 포함). */
        data object Clear : Verdict

        /** 신호도 확인도 아님 — 값은 다 있는데 발화와 해제 임계 사이다. */
        data object Unsettled : Verdict

        /** 모름 — 신호가 없고 모르는 칸이 있다. */
        data object Unknown : Verdict
    }

    fun isOutdoor(category: String?): Boolean = category in OUTDOOR

    /**
     * 판정 시각 — 시작 정시부터 끝을 올린 정시까지(양끝 포함, 자정 넘김 포함) 가운데 지금 정시 이후 ∧ 발표 뒤.
     * 예보를 모르면 발표 조건 없이 지금만으로 자른다. 비면 그 슬롯은 남은 슬롯이 아니다(모름도 아니다).
     */
    fun judgmentHours(e: Exposure, now: Instant): List<LocalDateTime> {
        val start = e.date.atTime(e.startAt).truncatedTo(ChronoUnit.HOURS)
        val end = (if (e.endsNextDay) e.date.plusDays(1) else e.date).atTime(e.endAt).let {
            if (it.truncatedTo(ChronoUnit.HOURS) == it) it else it.truncatedTo(ChronoUnit.HOURS).plusHours(1)
        }
        val from = LocalDateTime.ofInstant(now, ZONE).truncatedTo(ChronoUnit.HOURS)
        val base = e.forecast?.baseAt?.let { LocalDateTime.ofInstant(it, ZONE) }
        return generateSequence(start) { it.plusHours(1) }.takeWhile { !it.isAfter(end) }
            .filter { !it.isBefore(from) && (base == null || it.isAfter(base)) }
            .toList()
    }

    fun judge(exposures: List<Exposure>, now: Instant): Verdict {
        val looks = exposures.filter { isOutdoor(it.category) }.mapNotNull { look(it, now) }
        val hit = looks.filter { it.fired.isNotEmpty() }
        return when {
            hit.isNotEmpty() -> hazardOf(hit, looks.size)
            looks.all { it.clear } -> Verdict.Clear
            looks.any { it.missing } -> Verdict.Unknown
            else -> Verdict.Unsettled
        }
    }

    /** 슬롯 하나의 관측 — 걸린 변형(심각도·시각)·확인 여부·모르는 칸 여부·근거값. */
    private class Look(
        val exposure: Exposure,
        val fired: Map<TriggerVariant, TriggerSeverity>,
        val firedHours: Map<TriggerVariant, List<LocalDateTime>>,
        val clear: Boolean,
        val missing: Boolean,
        val popMax: Int?,
        val windMax: Double?,
        val heat: Double?,
        val cold: Double?,
    )

    private fun look(e: Exposure, now: Instant): Look? {
        val hours = judgmentHours(e, now)
        if (hours.isEmpty()) return null
        val f = e.forecast ?: return Look(e, emptyMap(), emptyMap(), clear = false, missing = true, null, null, null, null)
        val at: List<HourlyWeather?> = hours.map { f.hourly[it] }
        val nightView = e.category == NIGHT_VIEW
        fun firing(test: (HourlyWeather) -> Boolean) = hours.filterIndexed { i, _ -> at[i]?.let(test) == true }

        val rain = firing { w -> w.precipitation in RAINY || (w.precipitation == Precipitation.NONE && (w.pop ?: 0) >= WeatherThresholds.RAIN_POP) }
        val rainClear = at.all { w -> w != null && w.precipitation == Precipitation.NONE && (w.pop ?: Int.MAX_VALUE) < WeatherThresholds.RAIN_POP_CLEAR }
        val snow = firing { w -> w.precipitation in SNOWY }
        val snowClear = at.all { it?.precipitation == Precipitation.NONE }
        val wind = firing { w -> (w.wsd ?: 0.0) >= WeatherThresholds.WIND_MS }
        val windClear = at.all { w -> (w?.wsd ?: Double.MAX_VALUE) < WeatherThresholds.WIND_MS_CLEAR }

        // 기온 — 그 날 최고·최저(TMX·TMN)는 있으면 쓰는 보조값이다. 시간별 TMP 만으로도 판정된다.
        val noon = hours.indices.filter { hours[it].hour in WeatherThresholds.HEAT_HOURS }
        val heat = (noon.mapNotNull { at[it]?.tmp } + noon.map { hours[it].toLocalDate() }.distinct().mapNotNull { f.daily[it]?.tmx }).maxOrNull()
        val heatClear = noon.all { at[it]?.tmp != null } && (heat == null || heat < WeatherThresholds.HEAT_CLEAR_C)
        val cold = (at.mapNotNull { it?.tmp } + hours.map { it.toLocalDate() }.distinct().mapNotNull { f.daily[it]?.tmn }).minOrNull()
        val coldClear = at.all { it?.tmp != null } && (cold == null || cold > WeatherThresholds.COLD_CLEAR_C)

        // 흐림 — 야경 슬롯 시각의 과반이 흐림 ∧ 강수 없음이면 발화, 흐린 시각이 1/3 이하면 해제.
        val cloud = if (nightView) firing { w -> w.sky == Sky.OVERCAST && w.precipitation == Precipitation.NONE } else emptyList()
        val cloudFires = cloud.size * 2 > hours.size
        val cloudClear = !nightView || (at.all { it?.sky != null } && at.count { it?.sky == Sky.OVERCAST } * 3 <= hours.size)

        val fired = LinkedHashMap<TriggerVariant, TriggerSeverity>()
        val firedHours = LinkedHashMap<TriggerVariant, List<LocalDateTime>>()
        if (rain.isNotEmpty()) { fired[TriggerVariant.RAIN] = TriggerSeverity.RISK; firedHours[TriggerVariant.RAIN] = rain }
        if (snow.isNotEmpty()) { fired[TriggerVariant.SNOW] = TriggerSeverity.RISK; firedHours[TriggerVariant.SNOW] = snow }
        if (wind.isNotEmpty()) { fired[TriggerVariant.WIND] = TriggerSeverity.RISK; firedHours[TriggerVariant.WIND] = wind }
        if (heat != null && heat >= WeatherThresholds.HEAT_CAUTION_C) {
            fired[TriggerVariant.HEAT] = if (heat >= WeatherThresholds.HEAT_RISK_C) TriggerSeverity.RISK else TriggerSeverity.CAUTION
        }
        if (cold != null && cold <= WeatherThresholds.COLD_C) fired[TriggerVariant.COLD] = TriggerSeverity.RISK
        if (cloudFires) { fired[TriggerVariant.CLOUD] = TriggerSeverity.CAUTION; firedHours[TriggerVariant.CLOUD] = cloud }

        val missing = at.any { w -> w == null || w.pop == null || w.precipitation == null || w.tmp == null || w.wsd == null || (nightView && w.sky == null) }
        return Look(
            exposure = e,
            fired = fired,
            firedHours = firedHours,
            clear = fired.isEmpty() && rainClear && snowClear && windClear && heatClear && coldClear && cloudClear,
            missing = missing,
            popMax = at.mapNotNull { it?.pop }.maxOrNull(),
            windMax = at.mapNotNull { it?.wsd }.maxOrNull(),
            heat = heat,
            cold = cold,
        )
    }

    private fun hazardOf(hit: List<Look>, remaining: Int): Verdict.Hazard {
        val severityOf = hit.flatMap { it.fired.entries }
            .groupBy({ it.key }, { it.value })
            .mapValues { (_, all) -> all.maxBy { it.rank } }
        val severity = severityOf.values.maxBy { it.rank }
        val variant = PRECEDENCE.first { severityOf[it] == severity }
        fun of(v: TriggerVariant) = hit.filter { v in it.fired }
        return Verdict.Hazard(
            severity = severity,
            variant = variant,
            variants = PRECEDENCE.filter { it in severityOf },
            affected = hit.map { it.exposure }.sortedWith(compareBy({ it.startAt }, { it.slotKey })),
            remaining = remaining,
            hours = hit.flatMap { it.firedHours[variant].orEmpty() }.distinct().sorted(),
            baseAt = hit.mapNotNull { it.exposure.forecast?.baseAt }.max(),
            evidence = Evidence(
                popMax = of(TriggerVariant.RAIN).mapNotNull { it.popMax }.maxOrNull(),
                windMax = of(TriggerVariant.WIND).mapNotNull { it.windMax }.maxOrNull(),
                tempMax = of(TriggerVariant.HEAT).mapNotNull { it.heat }.maxOrNull(),
                tempMin = of(TriggerVariant.COLD).mapNotNull { it.cold }.minOrNull(),
            ),
        )
    }
}
