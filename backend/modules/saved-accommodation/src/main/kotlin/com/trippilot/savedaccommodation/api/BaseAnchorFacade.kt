package com.trippilot.savedaccommodation.api

import java.time.LocalDate
import java.util.UUID

/**
 * 거점 앵커 조회 퍼사드(C4 saved-accommodation) — 일정 생성(itinerary-generation)이 의존하는 공개 계약(R1, `..api..`).
 * 여행 숙박일별 확정 거점(AUTO)의 좌표만 노출 — 미해결(GAP/OVERLAP)·좌표 없는 날짜는 제외(부분 목록).
 * 판정은 CoverageResolver(INV-U1-16) 재사용. api-safe 타입만(UUID·LocalDate·Double).
 */
interface BaseAnchorFacade {
    /**
     * 소유 여행의 숙박일별 거점 좌표 앵커([startDate, endDate) 각 밤). 미소유·없는 여행이면 빈 목록.
     * 체크아웃일(endDate)은 숙박일이 아니므로 미포함 — 그 날 앵커는 호출측이 전날 거점(prev_stay)으로 파생한다.
     */
    fun findStayNightAnchors(accountId: UUID, tripId: UUID): List<DayAnchorView>
}

/** 날짜별 거점 좌표(api-safe). */
data class DayAnchorView(val date: LocalDate, val lat: Double, val lng: Double)
