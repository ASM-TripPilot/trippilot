package com.trippilot.trip.api

import java.time.LocalDate
import java.util.UUID

/**
 * 감시 대상 여행 조회(C6) — 공개 계약(R1, `..api..`). 호출자는 Plan-B 상황 스윕(C9 서버 스케줄러)이다.
 *
 * [TripFacade] 에 얹지 않은 이유는 파급이다 — 그쪽은 여러 모듈의 테스트 대역 수십 곳이 구현하고 있어
 * 메서드 하나가 그 전부를 건드린다. 묻는 것도 다르다: 사용자 맥락 없이 **날짜 구간에 걸친 살아 있는 여행 전부**를
 * 키셋 페이지로 읽는다. 스케줄러 경로에는 요청 계정이 없어서 소유 계정도 함께 준다.
 */
interface TripWatchFacade {
    /**
     * [from]~[to] 와 겹치는(종료일 ≥ [from] ∧ 시작일 ≤ [to]) 여행 — 삭제·종료 기록(`ended_at`)이 있는 여행은 빠진다.
     *
     * `trip_id` 오름차순 키셋이다: [after] 다음부터 [limit] 건(1..500 으로 묶는다). 다음 페이지는 마지막 `tripId` 를
     * [after] 로 넘기고, [limit] 보다 적게 오면 끝이다.
     */
    fun findOverlapping(from: LocalDate, to: LocalDate, after: UUID?, limit: Int): List<WatchedTrip>
}

/** 감시 대상 여행 한 건 — 소유 계정과 계획일 구간 [startDate, endDate](체크아웃일 포함, [TripGenerationContext] 와 같은 규약). */
data class WatchedTrip(val tripId: UUID, val accountId: UUID, val startDate: LocalDate, val endDate: LocalDate)
