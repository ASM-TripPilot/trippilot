package com.trippilot.trip.api

import java.time.LocalDate
import java.util.UUID

/**
 * 여행 조회 퍼사드(C6 trip) — 타 모듈(saved-accommodation 거점 배정)이 의존하는 공개 계약(R1, `..api..`).
 * api-safe 타입만 노출(UUID·LocalDate) — trip 내부 도메인(Trip·TripStatus 등)은 넘기지 않는다.
 */
interface TripFacade {
    /**
     * 소유 여행의 숙박 구간[startDate, endDate). 없거나 삭제됐거나 타 계정이면 null.
     * (호출 측이 null → 404 존재 은닉으로 매핑.)
     */
    fun findPeriod(accountId: UUID, tripId: UUID): TripPeriod?
}

/** 여행 숙박 구간 — endDate는 체크아웃일(숙박 없음). */
data class TripPeriod(val startDate: LocalDate, val endDate: LocalDate)
