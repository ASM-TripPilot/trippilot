package com.trippilot.itinerarygeneration.domain

import java.time.LocalTime

/**
 * 오늘을 "지금부터" 짤 때의 창 규칙 — 생성(`GenerateItineraryService.dayWindowOf`)과 재계획(AI 어댑터)이 함께 쓴다.
 * 둘이 따로 들고 있으면 저녁 생성은 한두 곳이 나오는데 같은 시각의 [다시 짜기]는 "대안 없음"이 된다.
 */
object TodayWindow {
    private const val LEAD_MIN = 30 // 첫 장소까지 이동 여유
    private const val STEP_MIN = 30 // 시작을 정시·반에 맞춘다(19:07 같은 시작 시각을 만들지 않게)
    private const val EVENING_SPAN_MIN = 120 // 저녁에 만들어도 지금부터 이만큼은 연다(한두 곳)
    private const val NIGHT_END_MIN = 23 * 60 + 59 // 밤에도 야경 한두 곳 — 하루 안 표현이라 23:59 에서 멈춘다
    private const val MINUTES_PER_DAY = 24 * 60
    // 밤 늦게 만든 오늘은 익일 01:00 까지(2026-10-20 사용자) — 끝이 시작보다 이른 새벽 시각이면 **다음 날**이다
    // (AI 경계 `TimeWindowSchema.overnight` 와 같은 규칙: 끝 ≤ 04:00). 방문 시작은 자정 전, 끝만 자정을 넘는다
    // (AI 조립 — 슬롯은 시작 시각 + `endsNextDay` 로 저장되므로 자정 뒤 **시작**은 표현이 없다).
    private const val OVERNIGHT_END_MIN = 60
    private const val OVERNIGHT_END_LIMIT_MIN = 4 * 60

    /** 한 곳도 못 넣는 짧은 오늘 창 — 이보다 짧으면 닫는다(조립이 빈 해를 내 폴백 표시가 붙는다). */
    const val MIN_WINDOW_MIN = 60

    /** 오늘 조립을 열 수 있는 가장 이른 시각 — 지금 + 이동 여유를 30분 단위로 올린다. 자정을 넘으면 null(오늘은 끝났다). */
    fun earliest(now: LocalTime): LocalTime? {
        val nowMin = now.toSecondOfDay() / 60 + LEAD_MIN
        val ceiled = (nowMin + STEP_MIN - 1) / STEP_MIN * STEP_MIN
        return if (ceiled >= MINUTES_PER_DAY) null else LocalTime.ofSecondOfDay(ceiled * 60L)
    }

    /**
     * 생성의 오늘 끝 — [eveningEnd] 가 하루 끝(23:59)에 막혀 지금부터 2시간을 못 채우면 **익일 01:00**.
     * 재계획(AI 어댑터)은 [eveningEnd] 그대로다 — 재계획 경계는 아직 자정 넘는 슬롯 시각을 주고받지 못한다.
     */
    fun generationEnd(from: LocalTime, end: LocalTime): LocalTime {
        val fromMin = from.toSecondOfDay() / 60
        return if (fromMin + EVENING_SPAN_MIN > NIGHT_END_MIN) LocalTime.ofSecondOfDay(OVERNIGHT_END_MIN * 60L) else eveningEnd(from, end)
    }

    /** 끝이 다음 날인 창인가 — 끝이 시작보다 이르고 새벽(≤ 04:00)일 때만. 그 밖의 거꾸로 된 창은 모순이다. */
    fun isOvernight(start: LocalTime, end: LocalTime): Boolean =
        end < start && end.toSecondOfDay() / 60 <= OVERNIGHT_END_LIMIT_MIN

    /** 열린 창인가 — 시작 < 끝, 또는 자정을 넘는 창. 끝 = 시작(길이 0)은 닫힌 날이다. */
    fun isOpen(start: LocalTime, end: LocalTime): Boolean = start < end || isOvernight(start, end)

    /** 창 길이(분) — 자정을 넘는 창은 다음 날 끝까지 센다. */
    fun spanMinutes(start: LocalTime, end: LocalTime): Int {
        val raw = (end.toSecondOfDay() - start.toSecondOfDay()) / 60
        return if (isOvernight(start, end)) raw + MINUTES_PER_DAY else raw
    }

    /** [from] 부터 한두 곳이 들어가도록 **기본 끝** [end] 를 늘린 값 — 지금부터 2시간, 하루 끝(23:59)까지. 줄이지는 않는다. */
    fun eveningEnd(from: LocalTime, end: LocalTime): LocalTime {
        val fromMin = from.toSecondOfDay() / 60
        val endMin = end.toSecondOfDay() / 60
        return LocalTime.ofSecondOfDay(maxOf(endMin, minOf(fromMin + EVENING_SPAN_MIN, NIGHT_END_MIN)) * 60L)
    }
}
