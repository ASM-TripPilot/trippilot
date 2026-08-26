package com.trippilot.trip.api

import java.time.LocalDate
import java.util.UUID

/**
 * 계정의 여행 목록 조회(C6) — 공개 계약(R1, `..api..`).
 *
 * [TripFacade] 에 얹지 않은 이유는 파급이다. 그쪽은 `accountId`+`tripId` 로 **한 건**을 묻는 계약이라
 * 네 모듈이 구현·대역으로 물고 있고, 메서드 하나가 그 전부를 건드린다. 여기 호출자는 기록 목록(U5)이고
 * 묻는 것도 다르다 — "이 계정의 여행들".
 */
interface TripListFacade {
    /**
     * 최신순(시작일 내림차순). 삭제된 여행은 나오지 않는다.
     *
     * [limit] 는 호출측이 조인다 — 전량 반환은 없다(`/places` 선례).
     */
    fun findTripsOf(accountId: UUID, limit: Int): List<TripSummaryView>

    /** 이 계정에 여행이 **하나라도** 있는가. 빈 목록과 "아직 아무것도 없음"을 가르는 값이다. */
    fun hasAnyTrip(accountId: UUID): Boolean
}

/** 목록 한 줄(api-safe). 상세는 각자의 표면이 낸다. */
data class TripSummaryView(
    val tripId: UUID,
    val title: String,
    val startDate: LocalDate,
    val endDate: LocalDate,
    val regions: List<String>,
)
