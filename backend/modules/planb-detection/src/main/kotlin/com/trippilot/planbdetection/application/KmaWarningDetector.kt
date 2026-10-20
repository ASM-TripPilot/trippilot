package com.trippilot.planbdetection.application

import com.trippilot.itinerarygeneration.api.PlannedSlotView
import com.trippilot.planbdetection.domain.DataSource
import com.trippilot.planbdetection.domain.PlanBTrigger
import com.trippilot.planbdetection.domain.SituationCopy
import com.trippilot.planbdetection.domain.SweepSource
import com.trippilot.planbdetection.domain.TriggerKind
import com.trippilot.planbdetection.domain.TriggerLifecycle
import com.trippilot.planbdetection.domain.TriggerSeverity
import com.trippilot.planbdetection.domain.WeatherAlerts
import com.trippilot.planbdetection.domain.WeatherHazards
import com.trippilot.trip.api.TripFacade
import com.trippilot.weathercontext.api.ActiveWarning
import com.trippilot.weathercontext.api.AlertRead
import com.trippilot.weathercontext.api.WeatherAlertFacade
import org.slf4j.LoggerFactory
import org.springframework.stereotype.Component
import java.time.Instant
import java.time.LocalDate
import java.util.concurrent.atomic.AtomicReference

/**
 * 기상특보 감지기(`kma-warning` · 설계서 §4.2 · BR-SA-16 · CD17) — 오늘 발효 중인 특보가 **그 날의 목적지**에 걸리면 오늘 남은 실외 슬롯
 * 전부에 위험 신호 하나(날짜 전체 — slotKey 없음). 특보는 기상청 발표 사실이라 문구에 특보 이름을 쓴다(BR-SA-12 ⑥ — 단기예보는 못 쓴다).
 *
 * | 상황 | 결과 |
 * |---|---|
 * | 남은 실외·미분류 슬롯이 없다 | 확인 — 부르지 않는다(실내로 바꾼 날은 해제된다) |
 * | 원천 모름(게이트웨이 거절 30 등·장애·형식 깨짐) | 모름 · 그 회차의 남은 여행은 부르지 않는다(캐시 없음 — 다음 회차에 다시 묻는다, COST-SA-05) |
 * | 여행·목적지를 못 읽음 | 모름 |
 * | 아는 종류가 그 날의 목적지에 걸림 | 위험 신호(실외 슬롯 전부) — 실외 슬롯 없이 미분류만 남았으면 모름(지어내지 않는다) |
 * | 모르는 종류가 걸림 · 코드 없는 목적지(동명이지역)가 섞임 | 신호가 없으면 모름 — '특보 없음'으로 확인하지 않는다(INV-SA-2) |
 * | 모르는 구역 이름(최상위 · 도 줄의 하위 구역) · 광역 하위 권역(산지)이 목적지 시군을 덮는지 가릴 수 없음 | 신호가 없으면 모름 — 모르는 이름은 바뀔 때 WARN 한 번 |
 * | 그 밖(걸린 특보 없음 — 특보 없음 `o 없 음` 포함) | 확인(날짜 전체) |
 *
 * **오늘만** 본다(`wants`) — 특보현황에 종료 시각이 없어 내일 이어질지 모른다. 실외 집합은 단기예보와 같은 [WeatherHazards.OUTDOOR] 다.
 * 출처를 따로 둔다(CD17) — 이 출처의 모름이 단기예보의 해제를 막지 않는다. 관찰 전용 목록에 든 채 출발한다(BR-SA-04).
 */
@Component
class KmaWarningDetector(private val alerts: WeatherAlertFacade, private val trips: TripFacade) : SituationDetector {

    override val source: String = SweepSource.KMA_WARNING

    override val kind: TriggerKind = TriggerKind.WEATHER

    /** 회차 범위 기억 — 원천 모름만 기억한다(성공은 서비스가 20분 기억한다). 회차 키가 바뀌면 버린다. */
    private val memo = AtomicReference(RoundMemo(Instant.EPOCH))

    /** 마지막으로 본 모르는 구역 이름 — 바뀔 때만 WARN 한다. */
    private val seenUnknownAreas = AtomicReference<Set<String>>(emptySet())

    override fun wants(phase: SweepPhase, dayOffset: Int): Boolean = dayOffset == 0

    /** 실 조회가 붙어 있을 때만(`WEATHER_MODE=kma`). 외부를 부르지 않는다. */
    override fun isLive(): Boolean = alerts.isLive()

    override fun detect(target: SweepTarget): Detection {
        val outdoor = target.slots.filter { WeatherHazards.isOutdoor(it.category) }
        val unclassified = target.slots.any { it.category == null }
        if (outdoor.isEmpty() && !unclassified) return CONFIRMED
        val round = memo.updateAndGet { if (it.round == target.round) it else RoundMemo(target.round) }
        round.unknown?.let { return Detection.Unknown(it) }
        val warnings = when (val read = alerts.warnings(target.now)) {
            is AlertRead.Ok -> read.value
            is AlertRead.Unknown -> {
                round.unknown = read.cause
                return Detection.Unknown(read.cause)
            }
        }
        val live = warnings.filter { it.type !in WeatherAlerts.IGNORED_WARNINGS }
        val unknownAreas = noteUnknownAreas(live)
        val destinations = dayDestinations(trips, target) ?: return Detection.Unknown(NO_DESTINATION)
        val places = destinations.mapNotNull { d -> d.regionCode?.let { WeatherAlerts.placeOf(it, d.name) } }
        val hits = mutableListOf<Pair<ActiveWarning, WeatherAlerts.Place>>()
        var unknownKind = false
        var unsure = false
        for (w in live) {
            fun matches(p: WeatherAlerts.Place, m: WeatherAlerts.Match) = w.areas.any { WeatherAlerts.match(it, p) == m }
            val place = places.firstOrNull { matches(it, WeatherAlerts.Match.HIT) }
            when {
                place == null -> unsure = unsure || places.any { matches(it, WeatherAlerts.Match.UNSURE) }
                w.type in WeatherAlerts.WARNING_VARIANTS -> hits += w to place
                else -> unknownKind = true
            }
        }
        return when {
            hits.isNotEmpty() && outdoor.isEmpty() -> Detection.Unknown(UNCLASSIFIED)
            hits.isNotEmpty() -> Detection.Checked(emptySet(), listOf(signalOf(hits, outdoor, target)))
            unknownKind -> Detection.Unknown(UNKNOWN_KIND)
            unsure -> Detection.Unknown(if (unknownAreas.isNotEmpty()) UNKNOWN_AREA else UNATTRIBUTED)
            places.size < destinations.size -> Detection.Unknown(NO_REGION)
            else -> CONFIRMED
        }
    }

    /**
     * 모르는 구역 이름 — 최상위(광역·섬 구역·바다가 아님 — `WeatherAlerts` 규칙 2)와 도 줄의 하위 구역(시군 어간·광역 권역·섬 구역·바다가
     * 아님 — 규칙 8). t6 형식 변화·구역 개편의 신호라 바뀔 때만 WARN 한 번(파드 범위 · 같은 이름이 이어지면 조용하다). 많거나 긴 이름은
     * 잘라 싣는다. t6 는 정상 응답의 구역 이름이라 키가 없지만, 응답에서 온 글자라 ASCII 영숫자는 가려 싣는다(SEC-SA-03 — 구역 이름은
     * 한글·문장부호다).
     */
    private fun noteUnknownAreas(live: List<ActiveWarning>): Set<String> {
        val names = live.flatMap { it.areas }.flatMap(WeatherAlerts::unknownNames)
            .map { name -> name.take(NAME_CAP).map { if (it.code < 128 && it.isLetterOrDigit()) '*' else it }.joinToString("") }
            .toSortedSet()
        if (seenUnknownAreas.getAndSet(names) != names && names.isNotEmpty()) {
            log.warn(
                "기상특보 — 모르는 특보 구역 이름 {} 이 있습니다(t6 형식 변화·특보구역 개편). 그 구역은 목적지를 가릴 수 없어 '특보 없음'으로 " +
                    "확인하지 않고 모름으로 둡니다 — WeatherAlerts 의 광역·섬 구역·시군 어간 표를 확인하십시오.",
                names.take(NAMES_CAP),
            )
        }
        return names
    }

    private fun signalOf(hits: List<Pair<ActiveWarning, WeatherAlerts.Place>>, outdoor: List<PlannedSlotView>, target: SweepTarget): DetectionSignal {
        val variants = WeatherAlerts.PRECEDENCE.filter { v -> hits.any { WeatherAlerts.WARNING_VARIANTS[it.first.type] == v } }
        // 대표 = 우선순위 첫 변형, 그 변형의 특보 가운데 경보가 주의보를 이긴다(같으면 원문 앞쪽).
        val (lead, place) = hits.filter { WeatherAlerts.WARNING_VARIANTS[it.first.type] == variants.first() }.maxBy { levelRank(it.first.level) }
        val slots = outdoor.sortedWith(compareBy({ it.startAt }, { it.slotKey }))
        val head = "기상청이 ${place.label}에 ${lead.title}를 발표했어요."
        // 이름이 길어 200자를 넘기면 이름 없이 — 가드에 걸려 신호를 통째로 잃지 않게(BR-SA-12).
        val reason = reasonOf(head, slots, withName = true).takeIf { it.length <= SituationCopy.MAX_LENGTH }
            ?: reasonOf(head, slots, withName = false)
        return DetectionSignal(
            kind = TriggerKind.WEATHER,
            affectedDate = target.date,
            slotKey = null,
            payload = mapOf(
                PAYLOAD_VARIANTS to variants.map { it.name },
                PlanBTrigger.PAYLOAD_COVERAGE to WeatherHazards.Coverage.MOST.name, // 실외 슬롯 전부가 영향이다
                PAYLOAD_SLOT_KEYS to slots.map { it.slotKey },
                PAYLOAD_WARNINGS to hits.map { it.first.title }.distinct(),
            ),
            reason = reason,
            scope = TriggerLifecycle.sweepScope(target.date, LocalDate.ofInstant(target.now, TriggerLifecycle.TRAVEL_ZONE)),
            severity = TriggerSeverity.RISK,
            variant = variants.first(),
            dataSource = DataSource.KMA_WARNING,
            poiIds = slots.map { it.poiId }.distinct(),
        )
    }

    private fun reasonOf(head: String, slots: List<PlannedSlotView>, withName: Boolean): String =
        "$head ${WeatherAlerts.affectedPhrase(slots.first().nameKo.takeIf { withName }, slots.size)} 영향을 받을 수 있어요."

    private fun levelRank(level: String): Int = if (level == WARNING_LEVEL) 1 else 0

    /** 한 회차의 기억 — 여행 단위 병렬이라 스레드 안전하다. */
    private class RoundMemo(val round: Instant) {
        /** 원천 모름의 원인 — 있으면 그 회차의 남은 여행은 부르지 않는다. */
        @Volatile var unknown: String? = null
    }

    private companion object {
        private val log = LoggerFactory.getLogger(KmaWarningDetector::class.java)
        private val CONFIRMED = Detection.Checked(setOf(null), emptyList())

        private const val WARNING_LEVEL = "경보"
        private const val NO_DESTINATION = "no-destination"
        private const val NO_REGION = "no-region"
        private const val UNKNOWN_KIND = "unknown-warning"
        private const val UNCLASSIFIED = "unclassified-slots"

        /** 표에 없는 구역 이름이 있다 — 최상위(규칙 2) 또는 도 줄의 하위 구역(규칙 8). */
        private const val UNKNOWN_AREA = "unknown-area"

        /** 광역 하위 권역(산지)이 목적지 시군을 덮는지 가릴 수 없다(규칙 8). */
        private const val UNATTRIBUTED = "unattributed-zone"

        private const val NAME_CAP = 30
        private const val NAMES_CAP = 5

        private const val PAYLOAD_VARIANTS = "variants"
        private const val PAYLOAD_SLOT_KEYS = "slotKeys"
        private const val PAYLOAD_WARNINGS = "warnings"
    }
}
