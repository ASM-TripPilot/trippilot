package com.trippilot.itinerarygeneration.domain

import java.time.Instant

/**
 * INV-4 결정론 폴백 — ScheduleAgent(AI) 실패 시 침묵 금지(silent failure forbidden).
 * must_visit 고정 블록(시각 지정분)만으로 최소 일정을 결정론적으로 구성한다: AI 추천·최적화 없음.
 * isFallback=true·MINIMAL 로 표시해 클라이언트가 '최소 일정' 상태를 드러내게 한다.
 * (framework-free, R2 순수 — 시각/순서는 입력 고정 블록 그대로이므로 솔버 검증 불필요.)
 */
object MinimalItineraryFallback {
    fun of(input: ScheduleAgentInput, at: Instant): ScheduleAgentOutput {
        val fixedByDate = input.fixedBlocks.filter { it.date != null && it.start != null }.groupBy { it.date }
        // 날짜 미지정(ANYTIME) must_visit — 버리면 폴백 일정에서 통째로 사라져 HC3 가 깨진다.
        // 첫 일자의 지정 블록 뒤에 순서대로 붙인다(겹치지 않게).
        val undated = input.fixedBlocks.filter { it.date == null }
        val days = input.timeWindows.mapIndexed { dayIdx, tw ->
            val dated = fixedByDate[tw.date].orEmpty().sortedBy { it.start }.map { fb ->
                val start = fb.start!!
                VisitSlotDisplay(
                    poiId = fb.poiId,
                    startAt = start,
                    endAt = start.plusMinutes((fb.dwellMin ?: DEFAULT_DWELL_MIN).toLong()),
                    endsNextDay = false,
                    distanceRange = null, // 거리 추정 없음(폴백)
                    isFixed = true,
                )
            }
            val anytime = if (dayIdx != 0 || undated.isEmpty()) {
                emptyList()
            } else {
                var cursor = maxOf(dated.maxOfOrNull { it.endAt } ?: tw.start, tw.start)
                undated.map { fb ->
                    val start = cursor
                    cursor = start.plusMinutes((fb.dwellMin ?: DEFAULT_DWELL_MIN).toLong())
                    VisitSlotDisplay(fb.poiId, start, cursor, endsNextDay = false, distanceRange = null, isFixed = true)
                }
            }
            DaySchedule(tw.date, dated + anytime)
        }
        return ScheduleAgentOutput(
            days = days,
            day1ReadyAt = null,
            explanations = emptyMap(),
            solveMode = SolveMode.MINIMAL,
            isFallback = true,
            freshness = FreshnessMeta(at, degraded = true),
        )
    }

    private const val DEFAULT_DWELL_MIN = 60
}
