package com.trippilot.itinerarygeneration.domain

import java.time.Instant

/**
 * INV-4 결정론 폴백 — ScheduleAgent(AI) 실패 시 침묵 금지(silent failure forbidden).
 * must_visit 고정 블록(시각 지정분)만으로 최소 일정을 결정론적으로 구성한다: AI 추천·최적화 없음.
 * isFallback=true·MINIMAL 로 표시해 클라이언트가 '최소 일정' 상태를 드러내게 한다.
 * (framework-free, R2 순수 — 시각/순서는 입력 고정 블록 그대로이므로 솔버 검증 불필요.)
 */
object MinimalItineraryFallback {
    /**
     * "변경 불가"(isFixed) 표시는 사용자 고정에만 붙는다(TRIP-1001 · QA #049) — 판정은 `start != null` 하나다.
     * 시각이 있는 블록은 사용자가 고정한 것뿐이고, 물질화된 ANYTIME 은 `start == null` 로 온다(TRIP-1249).
     */
    fun of(input: ScheduleAgentInput, at: Instant): ScheduleAgentOutput {
        val windowDates = input.timeWindows.map { it.date }.toSet()
        val (timed, untimed) = input.fixedBlocks.partition { it.date != null && it.start != null }
        val fixedByDate = timed.groupBy { it.date }
        // 시각 없는 must_visit 은 둘이다 — 날짜만 있는 것(물질화된 ANYTIME, TRIP-1249: **그 날**에 놓는다)과
        // 날짜조차 없는 것(자리 있는 첫날부터). 어느 쪽도 버리지 않는다 — 버리면 폴백 일정에서 통째로 사라져
        // HC3 가 깨진다(포함이 요건). 다만 한 날에 무한정 쌓으면 LocalTime 이 자정을 넘어 감겨 endAt < startAt 이
        // 되고(endsNextDay=false) 슬롯 검증에서 터진다 — 그래서 그 날 창이 차면 다음 날로 넘기고, 넘길 날이 없으면
        // 미배치로 **보고**한다(아래 unplacedMustVisits).
        val (onDay, dateless) = untimed.partition { it.date in windowDates }
        val untimedByDate = onDay.groupBy { it.date }
        val undated = ArrayDeque(dateless)
        val days = input.timeWindows.map { tw ->
            val dated = fixedByDate[tw.date].orEmpty().sortedBy { it.start }.map { fb ->
                val start = fb.start!!
                VisitSlotDisplay(
                    poiId = fb.poiId,
                    startAt = start,
                    endAt = start.plusMinutes((fb.dwellMin ?: DEFAULT_DWELL_MIN).toLong()),
                    endsNextDay = false,
                    distanceRange = null, // 거리 추정 없음(폴백)
                    isFixed = true, // 시각이 있는 블록 = 사용자 고정. 물질화된 ANYTIME 은 시각이 없어 아래 갈래다.
                )
            }
            val anytime = mutableListOf<VisitSlotDisplay>()
            var cursor = maxOf(dated.maxOfOrNull { it.endAt } ?: tw.start, tw.start)
            // 지정 블록 뒤에 이어 붙인다. 창 초과 또는 자정 감김이면 이 날엔 못 넣는다.
            fun place(fb: FixedBlock): Boolean {
                val end = cursor.plusMinutes((fb.dwellMin ?: DEFAULT_DWELL_MIN).toLong())
                if (end > tw.end || end <= cursor) return false
                // 시각을 사용자가 안 정했다 — "변경 불가"로 보이면 거짓(TRIP-1001)
                anytime += VisitSlotDisplay(fb.poiId, cursor, end, endsNextDay = false, distanceRange = null, isFixed = false)
                cursor = end
                return true
            }
            // 그 날 몫(날짜만 있는 블록)이 먼저다. 그 날에 안 들어가면 날짜 없는 줄 **뒤**로 보낸다 — 조용히 버리지 않는다.
            untimedByDate[tw.date].orEmpty().forEach { if (!place(it)) undated.addLast(it) }
            while (undated.isNotEmpty() && place(undated.first())) undated.removeFirst()
            DaySchedule(tw.date, dated + anytime)
        }
        return ScheduleAgentOutput(
            days = days,
            day1ReadyAt = null,
            explanations = emptyMap(),
            solveMode = SolveMode.MINIMAL,
            isFallback = true,
            freshness = FreshnessMeta(at, degraded = true),
            // 마지막 날까지 돌고도 남은 것 = 어느 날에도 안 들어간 것(하루 여행의 저녁 고정 뒤 ANYTIME, 체류 0분).
            // 종전엔 여기서 그대로 버려져 일정에도 보고에도 없이 사라졌다(INV-4 침묵 실패) — M2 채널로 알린다.
            unplacedMustVisits = undated.map { UnplacedMustVisit(it.poiId, UnplacedReason.NO_FEASIBLE_SLOT) },
        )
    }

    private const val DEFAULT_DWELL_MIN = 60
}
