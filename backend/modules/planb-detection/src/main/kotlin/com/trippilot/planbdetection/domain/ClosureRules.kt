package com.trippilot.planbdetection.domain

import com.trippilot.itinerarygeneration.api.CheckedSlot
import com.trippilot.itinerarygeneration.api.HoursVerdict
import com.trippilot.placedata.api.PoiLifeStatus
import java.time.Instant
import java.time.LocalDate
import java.time.LocalTime
import java.util.UUID

/**
 * 장소 판정(BR-SA-17 · 설계서 §4.3) — 하루 점검(영업시간)과 장소 상태(폐업)로 슬롯마다 발견·확인을 가른다. 순수 함수다.
 *
 * 1. 오늘은 계획 시작이 지금 이후인 슬롯만 본다 — 이미 시작한 방문은 알려도 바꿀 수 없다. 미래일은 전부 본다.
 * 2. 상태 `CLOSED` → `PERMANENTLY_CLOSED` — 영업시간보다 우선하고, 편집 때 볼 수 없었던 사실이라 경고 이력과 무관하게 알린다.
 * 3. 영업시간 위반(HC1)인데 편집 때 이미 본 경고가 아니면 AI 하위 코드대로 `CLOSED_DAY`·`HOLIDAY`·`OUT_OF_HOURS`, 하위 코드가
 *    없거나 모르는 값이면 `HOURS_MISMATCH`. 같은 장소를 하루 두 번 넣었으면 더 확실한 쪽(AI 의 우선순위와 같다).
 *    단 그 슬롯에 `PERMANENTLY_CLOSED` 가 떠 있는데 이번에 폐업 여부를 모르면(조회 실패·행 없음·OTHER) 내지 않는다 — 내면
 *    판정이 떠 있는 폐업을 제자리에서 영업시간 위반으로 갈아 끼운다(모름은 트리거를 바꾸지 않는다 — INV-SA-2).
 * 4. 확인 = 상태 ACTIVE ∧ 판정 OK ∧ 그 슬롯의 ACTIVE 가 `HOLIDAY` 아님 — 공휴일 휴무는 감지기가 해제하지 않는다.
 *    OK 는 AI 가 그 장소의 영업시간을 실제로 본 것이다 — 원문이 있어도 해석하지 못했다고 답한 장소는 하루 점검이 UNKNOWN 으로 준다.
 *
 * 같은 장소를 같은 날 두 번 넣으면 slotKey(`{date}#{poiId}`)가 같다 — 대상 하나로 보고, 발견은 대상당 하나다.
 * 모름은 그 근거로 발견도 확인도 만들지 않는다(INV-SA-2) — 상태 모름(`LOST`·`UNVERIFIED`·조회 실패)은 폐업 발견·확인이 없고,
 * 영업시간 UNKNOWN 은 영업시간 발견·확인이 없다. 한쪽이 모름이어도 다른 쪽 근거의 발견은 그대로 낸다.
 *
 * 문구는 단정하지 않는다(BR-SA-12 ⑦) — 휴무 원문은 수집 시점 데이터이고 파서가 넓혀 읽을 수 있다. 폐업만 `확인됐어요`.
 */
object ClosureRules {

    /** 이름을 모를 때의 주어(BR-SA-12 ⑦). */
    const val NAMELESS = "방문 예정지 한 곳이"

    /** 대상(슬롯) 하나의 발견 — 신호 한 건이 된다. [reason] 은 문구 가드를 지나는 꼴이다. */
    data class Finding(val slotKey: String, val poiId: UUID, val variant: TriggerVariant, val dataSource: String, val reason: String)

    /**
     * @property checked 신호가 없다고 확인한 슬롯 — 그 출처가 띄운 트리거의 해제 근거다.
     * @property blind 본 슬롯이 있는데 발견도 확정 판정(상태 ACTIVE 이면서 영업시간 판정 있음)도 없다 — 감지기는 모름으로 낸다.
     *   빈 확인으로 내면 감시 상태가 '확인됨'이 된다 — AI 보류·상태 조회 실패가 조용히 정상으로 보인다(RES-SA-01).
     */
    data class Verdict(val findings: List<Finding>, val checked: Set<String>, val blind: Boolean)

    /**
     * @param now 판정 시각 — '오늘'과 '지금'을 여행지 기준(KST)으로 정한다.
     * @param status 장소 상태. null = 조회 실패(폐업 판정·확인 없음, 영업시간 발견은 그대로). 키가 없는 POI 는 모름이다.
     * @param active 그 날 이 출처가 띄운 ACTIVE 의 변형(slotKey → variant) — 공휴일 휴무는 확인하지 않고, 폐업은 모르는 회차가 바꾸지 않는다.
     */
    fun judge(
        date: LocalDate,
        now: Instant,
        slots: List<CheckedSlot>,
        status: Map<UUID, PoiLifeStatus>?,
        active: Map<String, TriggerVariant>,
    ): Verdict {
        val today = LocalDate.ofInstant(now, TriggerLifecycle.TRAVEL_ZONE)
        val nowTime = LocalTime.ofInstant(now, TriggerLifecycle.TRAVEL_ZONE)
        val seen = slots.filter { date != today || it.startAt > nowTime }
        val targets = seen.groupBy { it.slotKey }
        val findings = targets.mapNotNull { (key, group) -> findingOf(key, group, status, active[key], date, today) }
        val raised = findings.map { it.slotKey }.toSet()
        val checked = targets.filter { (key, group) ->
            key !in raised && active[key] != TriggerVariant.HOLIDAY &&
                group.all { status?.get(it.poiId) == PoiLifeStatus.ACTIVE && it.hours == HoursVerdict.OK }
        }.keys
        val learned = seen.any { status?.get(it.poiId) == PoiLifeStatus.ACTIVE && it.hours != HoursVerdict.UNKNOWN }
        return Verdict(findings, checked, blind = findings.isEmpty() && seen.isNotEmpty() && !learned)
    }

    private fun findingOf(
        key: String, group: List<CheckedSlot>, status: Map<UUID, PoiLifeStatus>?, current: TriggerVariant?, date: LocalDate, today: LocalDate,
    ): Finding? {
        val slot = group.first() // 같은 키 = 같은 장소 — 상태·이름이 같다
        val state = status?.get(slot.poiId)
        val (variant, source) = when {
            state == PoiLifeStatus.CLOSED -> TriggerVariant.PERMANENTLY_CLOSED to DataSource.PLACE_STATUS
            current == TriggerVariant.PERMANENTLY_CLOSED && state != PoiLifeStatus.ACTIVE -> return null // 폐업 여부를 모른다
            group.any { it.hours == HoursVerdict.VIOLATED && !it.hoursWarnedBefore } ->
                hoursVariant(group.filter { it.hours == HoursVerdict.VIOLATED && !it.hoursWarnedBefore }) to DataSource.AI_VALIDATE
            else -> return null
        }
        val name = slot.nameKo?.takeIf { it.isNotBlank() }?.let(SituationCopy::shortName)
        val topic = name?.let { "‘$it’${topicOf(it)}" } ?: NAMELESS
        val subject = name?.let { "‘$it’" } ?: NAMELESS
        val sentence = when (variant) {
            TriggerVariant.PERMANENTLY_CLOSED -> "$topic 폐업한 곳으로 확인됐어요"
            TriggerVariant.CLOSED_DAY -> "$topic 정기 휴무일로 나와요"
            TriggerVariant.OUT_OF_HOURS -> "계획한 시간엔 $subject 문을 열지 않는 것으로 나와요"
            TriggerVariant.HOLIDAY -> "공휴일이라 $subject 쉬는 날로 나와요"
            else -> "계획한 시간엔 $subject 영업하지 않는 것으로 나와요"
        }
        // 상대 날짜어는 쓰지 않는다 — 저장된 문장은 다음 날 틀린 말이 된다. 미래일은 날짜를 앞에 붙인다.
        val reason = if (date == today) sentence else "${SituationCopy.dayPrefix(date)} $sentence"
        return Finding(key, slot.poiId, variant, source, reason)
    }

    /** HC1 하위 코드 — 더 확실한 것부터(AI `check_hc1` 의 우선순위와 같다). 이 밖의 값은 모르는 값이다. */
    private val HOURS_CODES = listOf(TriggerVariant.CLOSED_DAY, TriggerVariant.HOLIDAY, TriggerVariant.OUT_OF_HOURS)

    /** 새 영업시간 위반 슬롯들의 변형 — 하위 코드가 없거나 모르면 `HOURS_MISMATCH`(BR-SA-17). */
    private fun hoursVariant(fresh: List<CheckedSlot>): TriggerVariant =
        HOURS_CODES.firstOrNull { code -> fresh.any { it.reasonCode == code.name } } ?: TriggerVariant.HOURS_MISMATCH

    /** 주제 조사 — 받침이 있으면 `은`, 없으면 `는`. 한글로 끝나지 않으면 읽는 법을 몰라 둘 다 적는다. */
    private fun topicOf(name: String): String {
        val last = name.last()
        if (last !in '가'..'힣') return "은(는)"
        return if ((last - '가') % JONGSEONG_COUNT == 0) "는" else "은"
    }

    /** 한글 음절의 종성 경우의 수(받침 없음 포함) — 음절 코드 = 0xAC00 + (초성 × 21 + 중성) × 28 + 종성. */
    private const val JONGSEONG_COUNT = 28
}
