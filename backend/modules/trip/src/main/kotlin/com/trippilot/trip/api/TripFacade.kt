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
    /**
     * 목적지(표시 순서). **이름과 코드를 한 값으로 묶는다**(TRIP-859 후속).
     *
     * 병렬 리스트(`destinations` + `destinationCodes`)로 두지 않은 이유: "같은 순서·같은 길이"라는
     * 불변식을 사람이 지켜야 하고, 어긋나면 **엉뚱한 지역 좌표가 앵커가 되는데** 그 증상은
     * "일정이 다른 동네에서 돈다"라 원인이 안 보인다. 한 값이면 어긋날 자리가 없다.
     */
    val destinationRefs: List<TripDestinationRef>,
    val companionType: String?,           // 혼자/친구/연인/가족
    val budgetTotal: Long?,               // 1인 총예산(원)
    val fixedVisits: List<FixedVisit>,
) {
    /** 이름만 필요한 소비처를 위한 **파생**. 저장하지 않으므로 코드와 어긋날 수 없다. */
    val destinations: List<String> get() = destinationRefs.map { it.name }
}

/**
 * 목적지 하나 — 표시 이름과 행정구역 표준코드.
 *
 * [regionCode] 가 `null` 인 경우가 정상이다(이름만으로 확정 못 한 동명이지역, 또는 코드를 안 보낸
 * 옛 클라이언트). 그때는 소비처가 이름으로 떨어진다 — **지어내지 않는다.**
 */
data class TripDestinationRef(val name: String, val regionCode: String?)

/** 필수 방문지(고정 블록 HC3 원천). ANYTIME이면 date/start/dwellMin null. */
data class FixedVisit(val poiId: UUID, val date: LocalDate?, val start: LocalTime?, val dwellMin: Int?)
