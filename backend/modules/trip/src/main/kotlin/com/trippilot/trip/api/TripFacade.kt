package com.trippilot.trip.api

import java.time.LocalDate
import java.time.LocalTime
import java.util.UUID

/**
 * 여행 조회 퍼사드(C6 trip) — 타 모듈(saved-accommodation 거점 배정 · itinerary-generation 생성)이 의존하는 공개 계약(R1, `..api..`).
 * api-safe 타입만 노출(UUID·LocalDate·LocalTime·String) — trip 내부 도메인(Trip·CompanionType 등)은 넘기지 않는다.
 */
interface TripFacade {
    /**
     * 소유 여행의 숙박 구간[startDate, endDate). 없거나 삭제됐거나 타 계정이면 null.
     * (호출 측이 null → 404 존재 은닉으로 매핑.)
     */
    fun findPeriod(accountId: UUID, tripId: UUID): TripPeriod?

    /**
     * 일정 생성 컨텍스트 — 소유 여행의 날짜·목적지·동행·예산 + 필수 방문지(고정 블록 원천).
     * 없거나 삭제·타 계정이면 null. 앵커(거점 좌표)·취향(preference_snapshot)은 후속 확장.
     */
    fun findGenerationContext(accountId: UUID, tripId: UUID): TripGenerationContext?
}

/** 여행 숙박 구간 — endDate는 체크아웃일(숙박 없음). */
data class TripPeriod(val startDate: LocalDate, val endDate: LocalDate)

/** 일정 생성 컨텍스트(api-safe). 계획일은 [startDate, endDate] 각 날짜(체크아웃일 포함). */
data class TripGenerationContext(
    val startDate: LocalDate,
    val endDate: LocalDate,
    val destinations: List<String>,       // 지역 이름(표시 순서)
    val companionType: String?,           // 혼자/친구/연인/가족
    val budgetTotal: Long?,               // 1인 총예산(원)
    val fixedVisits: List<FixedVisit>,
)

/** 필수 방문지(고정 블록 HC3 원천). ANYTIME이면 date/start/dwellMin null. */
data class FixedVisit(val poiId: UUID, val date: LocalDate?, val start: LocalTime?, val dwellMin: Int?)
