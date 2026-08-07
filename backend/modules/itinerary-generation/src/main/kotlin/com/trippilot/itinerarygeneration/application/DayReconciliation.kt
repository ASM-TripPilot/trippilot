package com.trippilot.itinerarygeneration.application

import com.trippilot.itinerarygeneration.domain.DaySchedule
import org.slf4j.LoggerFactory
import java.time.LocalDate

/**
 * AI 응답의 일자 배열을 **이 호출이 요청한 일자**에 맞춰 정렬한다(TRIP-267 2단계 생성).
 *
 * 왜 필요한가: 응답은 외부(AI) 값이라 요청한 일자와 어긋날 수 있다. 2단계로 나눠 부르는 동안 어긋나면
 * - 1차가 전 일자를 돌려주면 2차가 같은 날짜를 **한 번 더** 덧붙여 중복 일자가 생기고,
 * - 1차가 빈 배열을 돌려주면 day1 이 **통째로 사라진 채** COMPLETE 로 끝난다.
 *
 * 둘 다 `dayOrder` 는 연속이라 애그리거트 불변식에 걸리지 않는다 — 여기서 막지 않으면 조용히 통과한다.
 * 요청 일자마다 정확히 하나의 [DaySchedule] 을 돌려주고(없으면 빈 슬롯), 요청 밖 일자는 버린다.
 */
object DayReconciliation {

    fun alignTo(dates: List<LocalDate>, days: List<DaySchedule>): List<DaySchedule> {
        val byDate = days.groupBy { it.date }
        val extras = days.map { it.date }.filterNot { it in dates }.distinct()
        if (extras.isNotEmpty()) {
            log.warn("요청하지 않은 일자를 응답에서 제외합니다 — 요청={}, 초과={}", dates, extras)
        }
        return dates.map { date ->
            val matched = byDate[date].orEmpty()
            if (matched.isEmpty()) log.warn("응답에 일자가 없어 빈 일자로 채웁니다 — date={}", date)
            if (matched.size > 1) log.warn("응답에 같은 일자가 중복돼 첫 번째만 씁니다 — date={}", date)
            matched.firstOrNull() ?: DaySchedule(date, emptyList())
        }
    }

    private val log = LoggerFactory.getLogger(DayReconciliation::class.java)
}
