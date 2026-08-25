package com.trippilot.savedaccommodation.api

import java.time.LocalDate
import java.util.UUID

/**
 * 날짜별 기준 숙소 조회(C4) — 공개 계약(R1, `..api..`).
 *
 * [BaseAnchorFacade] 와 따로 두는 이유가 둘이다. 하나는 파급 — 그쪽은 일정 생성·재계획 네 곳이
 * 구현·대역으로 물고 있다. 다른 하나는 **판정이 다르다**: 앵커는 좌표가 있어야 쓸모가 있어 좌표 없는
 * 숙소를 걸러내지만, 기록의 귀속은 **이름만 있어도 성립한다**(BR-U5-26). 좌표 유무로 거르면 기록이
 * 근거 없이 "숙소 없는 날"이 된다.
 */
interface TripBaseStayFacade {
    /**
     * 확정된 숙박일의 기준 숙소. 미해결(겹침·공백)이거나 등록 숙소가 없는 날은 **목록에 없다** —
     * 호출측은 그런 날을 날짜만으로 묶는다(BR-U5-27).
     */
    fun findBaseStays(tripId: UUID, startDate: LocalDate, endDate: LocalDate): List<DayBaseStayView>
}

data class DayBaseStayView(val date: LocalDate, val savedStayId: UUID, val name: String)
