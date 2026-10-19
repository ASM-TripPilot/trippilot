package com.trippilot.itinerarygeneration.api

import java.time.LocalDate
import java.time.LocalTime
import java.util.UUID

/**
 * 하루 점검(C8 · situation-awareness `domain-entities.md` §7.1) — 장소 감지(C9)가 아침에 오늘, 저녁에 내일 슬롯을
 * 영업시간으로 다시 보는 입구다.
 *
 * [ItineraryFacade]·[ItineraryPlanFacade] 에 얹지 않는 이유는 파급과 성격이다 — 저쪽은 구현·대역이 많은 조회 계약이고,
 * 이쪽은 **외부 호출(AI 검증)을 포함**한다. 그래서 호출자는 트랜잭션 밖에서 부른다(DB 커넥션을 문 채 AI 를 기다리지 않게).
 */
interface ItineraryDayCheckFacade {
    /**
     * 그 날 하루만 검증한다 — 같은 장소의 다른 날 위반이 섞이지 않게(BR-SA-17 ⑦).
     * null = 소유 아님 · 일정 없음 · 그 날 없음. 빈 날은 AI 를 부르지 않는다.
     */
    fun checkDay(accountId: UUID, tripId: UUID, date: LocalDate): DayCheck?
}

/**
 * 하루 점검 결과. [judged] = AI 가 판정했다 — false 면 판정 보류(불통·5xx·시한) 또는 AI 모드가 http 가 아니라
 * 영업시간은 전부 [HoursVerdict.UNKNOWN] 이다. 모름을 OK 로 채우지 않는다(INV-SA-2).
 */
data class DayCheck(val judged: Boolean, val slots: List<CheckedSlot>)

/**
 * 슬롯 하나의 점검값.
 *
 * @property slotKey 경계 키 `"{date}#{poiId}"`(BR-U2-04).
 * @property nameKo 화면이 쓰는 이름 — 확정 슬롯은 동결값이다(INV-U1-03). 정본·동결본 모두 없으면 null.
 * @property reasonCode HC1 하위 코드(`CLOSED_DAY`·`OUT_OF_HOURS`·`HOLIDAY`). AI 가 싣지 않으면 null —
 *   지금 경계에는 이 필드가 없어 늘 null 이다(하위 코드는 PR-H1 이 와이어와 함께 연다).
 * @property hoursWarnedBefore 그 슬롯이 이미 영업시간 위반 표시를 달고 있었다 — 편집 때 사용자가 본 경고다.
 */
data class CheckedSlot(
    val slotKey: String,
    val poiId: UUID,
    val nameKo: String?,
    val startAt: LocalTime,
    val hours: HoursVerdict,
    val reasonCode: String?,
    val hoursWarnedBefore: Boolean,
)

/** 영업시간 판정. [UNKNOWN] = AI 모드가 http 가 아님 · 판정 보류 · 영업시간 원문 없음. */
enum class HoursVerdict { VIOLATED, OK, UNKNOWN }
