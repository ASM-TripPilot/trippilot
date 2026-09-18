package com.trippilot.trip.domain

import java.time.LocalDate
import java.util.UUID

/**
 * 여행 카드에 붙는 집계(BR-U6-22) — **여행 모듈이 스스로 구할 수 없는 값**을 밖에서 받는다.
 *
 * ## 왜 퍼사드를 부르지 않고 포트를 선언하나
 *
 * 등록 숙소는 saved-accommodation 이, 일정 일수는 itinerary-generation 이 소유한다. 그런데
 * **그 둘이 모두 trip 을 의존한다.** 여기서 그쪽 `..api..` 를 부르면 순환이 되어 Gradle 이 빌드를
 * 막는다(R1). 그래서 필요한 모양만 이쪽에서 선언하고, 양쪽을 다 아는 유일한 자리(`app`)가 구현한다.
 *
 * ## 집계이지 저장이 아니다
 *
 * 컬럼을 늘리지 않는다 — 숙소를 지우거나 일정을 다시 만들면 그 순간 값이 달라져야 한다.
 * 저장해 두면 바뀐 뒤에도 옛 수가 카드에 남는다.
 */
interface TripAggregatePort {
    /**
     * 여러 여행을 **한 번에** 묻는다. 목록이 여행마다 따로 물으면 화면이 걷어내려던 N+1 이
     * 서버 안으로 옮겨 올 뿐이다.
     *
     * 반환 맵에 키가 없으면 호출측이 0 으로 읽는다 — 못 구한 것과 0 건은 화면에서 같은 그림이다.
     */
    fun countsOf(accountId: UUID, trips: List<TripDateRange>): Map<UUID, TripCounts>
}

/** 집계에 필요한 최소 재료. 거점 조회가 기간을 받으므로 날짜가 함께 간다. */
data class TripDateRange(val tripId: UUID, val startDate: LocalDate, val endDate: LocalDate)

/**
 * @property baseCount 등록 숙소 **수**(BR-U6-22) — 배정 구간 수가 아니라 **서로 다른 숙소의 수**다.
 *   한 숙소가 사흘을 덮어도 1이다. 0 이면 화면이 `숙소 미등록` 칩을 그린다.
 * @property itineraryDayCount 일정이 **있는 일수**. 0 = 아직 생성되지 않음.
 *   시간이 아니라 개수다 — 소요시간은 어디에도 싣지 않는다(INV-3).
 */
data class TripCounts(val baseCount: Int, val itineraryDayCount: Int) {
    companion object {
        /** 아무것도 없는 여행. 새로 만든 직후가 이 값이다. */
        val NONE = TripCounts(baseCount = 0, itineraryDayCount = 0)
    }
}
