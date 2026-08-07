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
        // 날짜 미지정(ANYTIME) must_visit — 버리면 폴백 일정에서 통째로 사라져 HC3 가 깨진다(포함이 요건).
        // 어느 날에 놓이는지는 폴백에서 따지지 않는다. 다만 한 날에 무한정 쌓으면 LocalTime 이 자정을 넘어 감겨
        // endAt < startAt 이 되고(endsNextDay=false) 슬롯 검증에서 터진다 — 그래서 그 날 창이 차면 다음 날로 넘긴다.
        val undated = ArrayDeque(input.fixedBlocks.filter { it.date == null })
        val days = input.timeWindows.map { tw ->
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
            val anytime = mutableListOf<VisitSlotDisplay>()
            var cursor = maxOf(dated.maxOfOrNull { it.endAt } ?: tw.start, tw.start)
            while (undated.isNotEmpty()) {
                val fb = undated.first()
                val end = cursor.plusMinutes((fb.dwellMin ?: DEFAULT_DWELL_MIN).toLong())
                if (end > tw.end || end <= cursor) break // 창 초과 또는 자정 감김 → 이 날은 여기까지
                anytime += VisitSlotDisplay(fb.poiId, cursor, end, endsNextDay = false, distanceRange = null, isFixed = true)
                cursor = end
                undated.removeFirst()
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
