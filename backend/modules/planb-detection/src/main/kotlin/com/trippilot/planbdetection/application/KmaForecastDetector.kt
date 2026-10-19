package com.trippilot.planbdetection.application

import com.trippilot.itinerarygeneration.api.PlannedSlotView
import com.trippilot.planbdetection.domain.DataSource
import com.trippilot.planbdetection.domain.SituationCopy
import com.trippilot.planbdetection.domain.SweepSource
import com.trippilot.planbdetection.domain.TriggerKind
import com.trippilot.planbdetection.domain.TriggerLifecycle
import com.trippilot.planbdetection.domain.TriggerVariant
import com.trippilot.planbdetection.domain.WeatherHazards
import com.trippilot.planbdetection.domain.WeatherHazards.Verdict
import com.trippilot.weathercontext.api.HourlyForecastFacade
import com.trippilot.weathercontext.api.HourlyForecastUnavailable
import com.trippilot.weathercontext.api.PointForecast
import org.springframework.stereotype.Component
import java.time.Instant
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.OffsetDateTime
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicReference
import kotlin.math.roundToInt

/**
 * 단기예보 감지기(`kma-forecast` · 설계서 §4.2 · BR-SA-15) — 남은 실외 슬롯을 **그 슬롯 좌표의 격자** 시간별 예보로 본다.
 *
 * 판정은 [WeatherHazards](순수), 예보는 [HourlyForecastFacade](읽기-통과 격자 캐시)다. 여기서는 슬롯 → 예보를 잇고, 판정을
 * 감지기 계약([Detection])으로 옮기고, 실패를 갈라 **회차 범위로 기억**한다(RES-SA-02·04 — 스윕은 격자·게이트웨이를 모른다).
 *
 * | 상황 | 결과 |
 * |---|---|
 * | 남은 실외 슬롯 0개 | 확인(날짜 전체) — 예보를 부르지 않는다 |
 * | 게이트웨이 거절(키 미등록 30 등) | 그 대상 모름 · 그 회차의 남은 대상도 부르지 않고 모름(캐시 없음 — 다음 회차에 다시 묻는다) |
 * | 시한·5xx·형식 깨짐 | 던진다(스윕이 격리·회로 차단을 센다) · 그 격자는 그 회차에 다시 부르지 않는다 |
 * | 자료 없음(03 소진·상한)·좌표 없음·칸 결측 | 그 슬롯만 모름 — 다른 슬롯에 신호가 있으면 발화, 없으면 모름 |
 *
 * 신호는 (여행, 날짜)당 하나이고 slotKey 가 없다(날씨는 날짜 단위 — [끄기]는 그 날 억제). 저장·이벤트를 하지 않는다.
 */
@Component
class KmaForecastDetector(private val forecasts: HourlyForecastFacade) : SituationDetector {

    override val source: String = SweepSource.KMA_FORECAST

    override val kind: TriggerKind = TriggerKind.WEATHER

    /** 회차 범위 기억 — 회차 키([SweepTarget.round])가 바뀌면 버린다(저장 없음). */
    private val memo = AtomicReference(RoundMemo(Instant.EPOCH))

    /** 실 기상청 격자 예보가 붙어 있을 때만(가짜 날씨면 격자 포트 빈이 없다). 외부를 부르지 않는다. */
    override fun isLive(): Boolean = forecasts.isLive()

    override fun detect(target: SweepTarget): Detection {
        val round = memo.updateAndGet { if (it.round == target.round) it else RoundMemo(target.round) }
        round.gateway?.let { return Detection.Unknown(GATEWAY + it) }
        val outdoor = target.slots.filter { WeatherHazards.isOutdoor(it.category) }
        if (outdoor.isEmpty()) return CONFIRMED // 실내로 바꾼 날은 해제된다
        val grids = HashMap<String, PointForecast?>()
        val exposures = outdoor.map { slot ->
            val forecast = try {
                forecastOf(slot, target.now, round, grids)
            } catch (e: HourlyForecastUnavailable) {
                val code = e.gatewayCode
                if (code == null) {
                    round.failed += e.gridKey
                    throw e
                }
                round.gateway = code
                return Detection.Unknown(GATEWAY + code)
            }
            WeatherHazards.Exposure(
                slot.slotKey, slot.poiId, slot.nameKo, slot.category, slot.date, slot.startAt, slot.endAt, slot.endsNextDay, forecast,
            )
        }
        return when (val verdict = WeatherHazards.judge(exposures, target.now)) {
            is Verdict.Hazard -> Detection.Checked(emptySet(), listOf(signalOf(verdict, target)))
            Verdict.Clear -> CONFIRMED
            Verdict.Unsettled -> Detection.Checked(emptySet(), emptyList()) // 두 임계 사이 — 신호도 확인도 아니다
            Verdict.Unknown -> Detection.Unknown(UNKNOWN)
        }
    }

    /** 슬롯의 격자 예보 — null 이면 그 슬롯은 모름이다. 한 대상 안에서 같은 격자는 한 번만 묻는다. */
    private fun forecastOf(slot: PlannedSlotView, at: Instant, round: RoundMemo, grids: MutableMap<String, PointForecast?>): PointForecast? {
        val lat = slot.lat ?: return null
        val lng = slot.lng ?: return null
        val key = forecasts.gridKeyOf(lat, lng) ?: return null
        if (key in round.failed) return null
        if (key in grids) return grids[key]
        return forecasts.forecastForTrigger(lat, lng, at).also {
            grids[key] = it
            if (it == null) round.failed += key // 03 소진이면 격자마다 HTTP 3건이 든다 — 그 회차엔 다시 묻지 않는다
        }
    }

    private fun signalOf(h: Verdict.Hazard, target: SweepTarget): DetectionSignal {
        val today = LocalDate.ofInstant(target.now, TriggerLifecycle.TRAVEL_ZONE)
        // 이름이 길어 200자를 넘기면 이름 없이 — 가드에 걸려 신호를 통째로 잃지 않게(BR-SA-12).
        val reason = reasonOf(h, target.date, today, withName = true).takeIf { it.length <= SituationCopy.MAX_LENGTH }
            ?: reasonOf(h, target.date, today, withName = false)
        return DetectionSignal(
            kind = TriggerKind.WEATHER,
            affectedDate = target.date,
            slotKey = null,
            payload = payloadOf(h),
            reason = reason,
            scope = TriggerLifecycle.sweepScope(target.date, today),
            severity = h.severity,
            variant = h.variant,
            dataSource = DataSource.KMA_VILAGE,
            poiIds = h.affected.map { it.poiId }.distinct(),
        )
    }

    /** 선계산 재료·되짚기(domain-entities §3.4) — 직렬화 가능 원시값만, 좌표 없음. 근거값은 발화한 변형의 것만. */
    private fun payloadOf(h: Verdict.Hazard): Map<String, Any> = buildMap {
        put(PAYLOAD_VARIANTS, h.variants.map { it.name })
        put(PAYLOAD_COVERAGE, h.coverage.name)
        put(PAYLOAD_SLOT_KEYS, h.affected.map { it.slotKey })
        put(PAYLOAD_BASE_AT, OffsetDateTime.ofInstant(h.baseAt, TriggerLifecycle.TRAVEL_ZONE).toString())
        h.evidence.popMax?.let { put("popMax", it) }
        h.evidence.windMax?.let { put("windMax", it) }
        h.evidence.tempMax?.let { put("tempMax", it) }
        h.evidence.tempMin?.let { put("tempMin", it) }
    }

    /**
     * 사유 문장(BR-SA-12) — 상대 날짜어 없이 미래일은 `M월 d일(E)` 머리, 걸린 시각이 한 시간대에 모이면 그 시간대(오전·오후·저녁·밤).
     * 단기예보 임계로 낸 신호라 '주의보'·'경보'를 쓰지 않는다. 출처 표기는 문장에 박지 않는다(응답 `attribution`).
     */
    private fun reasonOf(h: Verdict.Hazard, date: LocalDate, today: LocalDate, withName: Boolean): String {
        val day = if (date == today) "" else "${SituationCopy.dayPrefix(date)} "
        val band = bandOf(h.hours)?.let { "$it " }.orEmpty()
        val what = when (h.variant) {
            TriggerVariant.SNOW -> "${band}눈 소식이 있어요."
            TriggerVariant.WIND -> "${band}바람이 강하게 불 것으로 보여요."
            TriggerVariant.HEAT -> "한낮 기온이 ${h.evidence.tempMax!!.roundToInt()}도 안팎까지 올라요."
            TriggerVariant.COLD -> "기온이 영하 ${(-h.evidence.tempMin!!).roundToInt()}도 안팎까지 내려가요."
            TriggerVariant.CLOUD -> "${band}하늘이 흐려 야경이 잘 보이지 않을 수 있어요."
            else -> "${band}비 소식이 있어요." // RAIN — 판정이 내는 변형은 PRECEDENCE 여섯뿐이다
        }
        val noun = if (h.variant == TriggerVariant.CLOUD) "야경 일정" else "야외 일정"
        val first = h.affected.first().name?.takeIf { withName && it.isNotBlank() }
        val count = h.affected.size
        val who = when {
            count == 1 && first != null -> "$first 일정이"
            count == 1 -> "$noun 한 곳이"
            first != null -> "$first 등 $noun ${count}곳이"
            else -> "$noun ${count}곳이"
        }
        return "$day$what $who 영향을 받을 수 있어요."
    }

    /** 걸린 시각이 한 시간대에만 있으면 그 시간대, 여럿에 걸치거나 없으면 null(시간대를 뺀다). */
    private fun bandOf(hours: List<LocalDateTime>): String? = hours.map { bandOf(it.hour) }.distinct().singleOrNull()

    private fun bandOf(hour: Int): String = when (hour) {
        in 5..11 -> "오전에"
        in 12..17 -> "오후에"
        in 18..20 -> "저녁에"
        else -> "밤에"
    }

    /** 한 회차의 기억 — 여행 단위 병렬이라 스레드 안전하다. */
    private class RoundMemo(val round: Instant) {
        /** 게이트웨이 거절 원인 코드 — 있으면 그 회차의 남은 대상은 부르지 않는다. */
        @Volatile var gateway: String? = null

        /** 그 회차에 실패·자료 없음이었던 격자 — 다시 부르지 않는다. */
        val failed: MutableSet<String> = ConcurrentHashMap.newKeySet()
    }

    private companion object {
        /** 해소 확인(날짜 전체). */
        private val CONFIRMED = Detection.Checked(setOf(null), emptyList())

        private const val GATEWAY = "gateway:"
        private const val UNKNOWN = "forecast-unknown"

        private const val PAYLOAD_VARIANTS = "variants"
        private const val PAYLOAD_COVERAGE = "coverage"
        private const val PAYLOAD_SLOT_KEYS = "slotKeys"
        private const val PAYLOAD_BASE_AT = "baseAt"
    }
}
