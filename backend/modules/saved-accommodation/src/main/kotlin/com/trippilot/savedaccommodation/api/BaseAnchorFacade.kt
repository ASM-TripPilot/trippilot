package com.trippilot.savedaccommodation.api

import java.time.LocalDate
import java.util.UUID

/**
 * 거점 앵커 조회 퍼사드(C4 saved-accommodation) — 일정 생성(itinerary-generation)이 의존하는 공개 계약(R1, `..api..`).
 * **소유 검증은 호출측 책임**(일정 생성이 여행 소유·기간을 선확인) — 이 read 는 [startDate, endDate) 기간을 받아
 * 숙박일별 확정 거점(AUTO)의 좌표만 반환한다. GAP/OVERLAP·좌표 없는 날짜는 제외(부분 목록). 판정=CoverageResolver(INV-U1-16).
 */
interface BaseAnchorFacade {
    /**
     * 여행 [startDate, endDate) 숙박일별 거점 좌표 앵커(각 밤). 체크아웃일(endDate)은 숙박일이 아니므로 미포함 —
     * 그 날 앵커는 호출측이 전날 거점(prev_stay)으로 파생한다.
     */
    fun findStayNightAnchors(tripId: UUID, startDate: LocalDate, endDate: LocalDate): List<DayAnchorView>
}

/** 날짜별 거점 좌표(api-safe). */
data class DayAnchorView(val date: LocalDate, val lat: Double, val lng: Double)
