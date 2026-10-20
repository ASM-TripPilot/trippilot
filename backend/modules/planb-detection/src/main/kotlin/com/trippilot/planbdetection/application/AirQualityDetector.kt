package com.trippilot.planbdetection.application

import com.trippilot.itinerarygeneration.api.PlannedSlotView
import com.trippilot.planbdetection.domain.DataSource
import com.trippilot.planbdetection.domain.PlanBTrigger
import com.trippilot.planbdetection.domain.SituationCopy
import com.trippilot.planbdetection.domain.SweepSource
import com.trippilot.planbdetection.domain.TriggerKind
import com.trippilot.planbdetection.domain.TriggerLifecycle
import com.trippilot.planbdetection.domain.TriggerSeverity
import com.trippilot.planbdetection.domain.TriggerVariant
import com.trippilot.planbdetection.domain.WeatherAlerts
import com.trippilot.planbdetection.domain.WeatherHazards
import com.trippilot.trip.api.TripFacade
import com.trippilot.weathercontext.api.AirGrade
import com.trippilot.weathercontext.api.AirRegion
import com.trippilot.weathercontext.api.AlertRead
import com.trippilot.weathercontext.api.WeatherAlertFacade
import org.springframework.stereotype.Component
import java.time.Instant
import java.time.LocalDate
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicReference

/**
 * 대기질 감지기(`airkorea` · 설계서 §4.2 · BR-SA-16 · CD17) — 그 날 목적지의 에어코리아 예보 권역 등급으로 오늘(저녁 회차는 내일도)을 본다.
 * PM10·PM25 중 나쁜 쪽이 **나쁨 = 주의 · 매우나쁨 = 위험**(O-SA-3) · 둘 다 **보통 이하 = 확인**. 신호는 (여행, 날짜) 하나 — 영향은 남은 실외 슬롯 전부다.
 *
 * - 등급 문자열은 바꾸지 않는다(BR-SA-24 · 공공누리 3유형 변경 금지) — 문구는 `'나쁨'` 처럼 원문을 따옴표에 넣고, payload 에도 원문을 싣는다.
 *   출처 표기는 문장에 박지 않는다(응답 `attribution` = 에어코리아).
 * - 목적지 권역은 행정구역 코드로만 정한다([AirRegion.of]) — 코드 없는 목적지(동명이지역)·시도 단위로 갈리는 곳은 권역을 모른다(§8.2).
 * - 모름(INV-SA-2): 원천 모름 · 여행·목적지를 못 읽음 · 권역을 모름 · 한쪽 등급을 모름(없음·모르는 문자열) · 실외 없이 미분류 슬롯만 남음 —
 *   신호가 없으면 확인하지 않는다. 원천 모름(게이트웨이 거절·장애)은 그 회차 동안 날짜와 무관하게, 그 날 예보 없음은 그 회차·그 날짜만
 *   기억해 남은 여행은 부르지 않는다 — 실패 경로는 회차당 ≤ 2콜(여행 단위 병렬 2가 처음에 겹칠 때 · 거절·장애는 첫 요청에서 끝난다),
 *   하루 ≤ 30(COST-SA-05).
 * - 실외 슬롯·미분류 슬롯이 하나도 없으면 부르지 않고 확인이다(실내로 바꾼 날은 해제된다). 관찰 전용 목록에 든 채 출발한다(BR-SA-04).
 */
@Component
class AirQualityDetector(private val alerts: WeatherAlertFacade, private val trips: TripFacade) : SituationDetector {

    override val source: String = SweepSource.AIRKOREA

    override val kind: TriggerKind = TriggerKind.WEATHER

    /** 회차 범위 기억 — 원천 모름과 날짜별 예보 없음만(성공은 서비스가 발표 단위로 기억한다). 회차 키가 바뀌면 버린다. */
    private val memo = AtomicReference(RoundMemo(Instant.EPOCH))

    /** 오늘은 모든 회차, 내일은 저녁 회차만(BR-SA-01). */
    override fun wants(phase: SweepPhase, dayOffset: Int): Boolean = dayOffset == 0 || (dayOffset == 1 && phase == SweepPhase.EVENING)

    /** 실 조회가 붙어 있을 때만(`WEATHER_MODE=kma`). 외부를 부르지 않는다. */
    override fun isLive(): Boolean = alerts.isLive()

    override fun detect(target: SweepTarget): Detection {
        val outdoor = target.slots.filter { WeatherHazards.isOutdoor(it.category) }
        val unclassified = target.slots.any { it.category == null }
        if (outdoor.isEmpty() && !unclassified) return CONFIRMED
        val round = memo.updateAndGet { if (it.round == target.round) it else RoundMemo(target.round) }
        (round.source ?: round.noForecast[target.date])?.let { return Detection.Unknown(it) }
        val grades = when (val read = alerts.airGrades(target.date, target.now)) {
            is AlertRead.Ok -> read.value
            is AlertRead.Unknown -> {
                if (read.cause == AlertRead.NO_FORECAST) round.noForecast[target.date] = read.cause else round.source = read.cause
                return Detection.Unknown(read.cause)
            }
        }
        val destinations = dayDestinations(trips, target) ?: return Detection.Unknown(NO_DESTINATION)
        val looks = destinations.map { d ->
            val region = d.regionCode?.let { AirRegion.of(it) }
            Look(d.regionCode?.let { WeatherAlerts.placeOf(it, d.name)?.label } ?: d.name, region, region?.let { grades[it] })
        }
        // 가장 나쁜 목적지가 나쁨 이상이면 신호 — 다른 목적지를 몰라도 낸다(모름이 아는 위험을 지우지 않는다).
        val worst = looks.maxByOrNull { it.worstRank ?: -1 }?.takeIf { (it.worstRank ?: -1) >= BAD }
        return when {
            worst != null && outdoor.isEmpty() -> Detection.Unknown(UNCLASSIFIED)
            worst != null -> Detection.Checked(emptySet(), listOf(signalOf(worst, outdoor, target)))
            looks.all { it.clear } -> CONFIRMED
            else -> Detection.Unknown(NO_GRADE)
        }
    }

    private fun signalOf(look: Look, outdoor: List<PlannedSlotView>, target: SweepTarget): DetectionSignal {
        val grade = look.grade!!
        // 나쁜 쪽 — 같으면 미세먼지(PM10). 문구의 등급은 원문 그대로다.
        val byPm10 = (WeatherAlerts.airRank(grade.pm10) ?: -1) >= (WeatherAlerts.airRank(grade.pm25) ?: -1)
        val (pollutant, raw) = if (byPm10) "미세먼지" to grade.pm10!! else "초미세먼지" to grade.pm25!!
        val today = LocalDate.ofInstant(target.now, TriggerLifecycle.TRAVEL_ZONE)
        val day = if (target.date == today) "" else "${SituationCopy.dayPrefix(target.date)} "
        val slots = outdoor.sortedWith(compareBy({ it.startAt }, { it.slotKey }))
        val head = "$day${look.label} $pollutant 예보가 '$raw'이에요."
        // 이름이 길어 200자를 넘기면 이름 없이 — 가드에 걸려 신호를 통째로 잃지 않게(BR-SA-12).
        val reason = reasonOf(head, slots, withName = true).takeIf { it.length <= SituationCopy.MAX_LENGTH }
            ?: reasonOf(head, slots, withName = false)
        return DetectionSignal(
            kind = TriggerKind.WEATHER,
            affectedDate = target.date,
            slotKey = null,
            payload = buildMap {
                put(PAYLOAD_VARIANTS, listOf(TriggerVariant.DUST.name))
                put(PlanBTrigger.PAYLOAD_COVERAGE, WeatherHazards.Coverage.MOST.name) // 실외 슬롯 전부가 영향이다
                put(PAYLOAD_SLOT_KEYS, slots.map { it.slotKey })
                put(PAYLOAD_REGION, look.region!!.label)
                grade.pm10?.let { put(PAYLOAD_PM10, it) }
                grade.pm25?.let { put(PAYLOAD_PM25, it) }
            },
            reason = reason,
            scope = TriggerLifecycle.sweepScope(target.date, today),
            severity = if ((look.worstRank ?: BAD) >= VERY_BAD) TriggerSeverity.RISK else TriggerSeverity.CAUTION,
            variant = TriggerVariant.DUST,
            dataSource = DataSource.AIRKOREA,
            poiIds = slots.map { it.poiId }.distinct(),
        )
    }

    private fun reasonOf(head: String, slots: List<PlannedSlotView>, withName: Boolean): String =
        "$head ${WeatherAlerts.affectedPhrase(slots.first().nameKo.takeIf { withName }, slots.size)} 영향을 받을 수 있어요."

    /** 목적지 하나의 등급 — [worstRank] = 아는 쪽 가운데 나쁜 순위, [clear] = 두 쪽 다 알고 보통 이하. */
    private class Look(val label: String, val region: AirRegion?, val grade: AirGrade?) {
        private val ranks = listOf(WeatherAlerts.airRank(grade?.pm10), WeatherAlerts.airRank(grade?.pm25))
        val worstRank: Int? = ranks.filterNotNull().maxOrNull()
        val clear: Boolean = ranks.all { it != null && it < BAD }
    }

    /** 한 회차의 기억 — 여행 단위 병렬이라 스레드 안전하다. */
    private class RoundMemo(val round: Instant) {
        /** 원천 모름(게이트웨이 거절·장애)의 원인 — 있으면 그 회차의 남은 여행은 날짜와 무관하게 부르지 않는다(한 조회가 오늘·내일을 함께 준다). */
        @Volatile var source: String? = null

        /** 그 날 예보 없음 — 그 날짜만 부르지 않는다. */
        val noForecast = ConcurrentHashMap<LocalDate, String>()
    }

    private companion object {
        private val CONFIRMED = Detection.Checked(setOf(null), emptyList())

        /** 등급 순위(`WeatherAlerts.airRank`) — 나쁨 2 · 매우나쁨 3. */
        private const val BAD = 2
        private const val VERY_BAD = 3

        private const val NO_DESTINATION = "no-destination"
        private const val NO_GRADE = "no-grade"
        private const val UNCLASSIFIED = "unclassified-slots"

        private const val PAYLOAD_VARIANTS = "variants"
        private const val PAYLOAD_SLOT_KEYS = "slotKeys"
        private const val PAYLOAD_REGION = "region"
        private const val PAYLOAD_PM10 = "pm10"
        private const val PAYLOAD_PM25 = "pm25"
    }
}
