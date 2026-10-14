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

    /** 한 곳도 못 넣는 짧은 오늘 창 — 이보다 짧으면 닫는다(조립이 빈 해를 내 폴백 표시가 붙는다). */
    const val MIN_WINDOW_MIN = 60

    /** 오늘 조립을 열 수 있는 가장 이른 시각 — 지금 + 이동 여유를 30분 단위로 올린다. 자정을 넘으면 null(오늘은 끝났다). */
    fun earliest(now: LocalTime): LocalTime? {
        val nowMin = now.toSecondOfDay() / 60 + LEAD_MIN
        val ceiled = (nowMin + STEP_MIN - 1) / STEP_MIN * STEP_MIN
        return if (ceiled >= MINUTES_PER_DAY) null else LocalTime.ofSecondOfDay(ceiled * 60L)
    }

    /** [from] 부터 한두 곳이 들어가도록 **기본 끝** [end] 를 늘린 값 — 지금부터 2시간, 하루 끝(23:59)까지. 줄이지는 않는다. */
    fun eveningEnd(from: LocalTime, end: LocalTime): LocalTime {
        val fromMin = from.toSecondOfDay() / 60
        val endMin = end.toSecondOfDay() / 60
        return LocalTime.ofSecondOfDay(maxOf(endMin, minOf(fromMin + EVENING_SPAN_MIN, NIGHT_END_MIN)) * 60L)
    }
}
