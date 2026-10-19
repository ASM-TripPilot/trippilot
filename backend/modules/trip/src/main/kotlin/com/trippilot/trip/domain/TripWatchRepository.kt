package com.trippilot.trip.domain

import com.trippilot.trip.api.WatchedTrip
import java.time.LocalDate
import java.util.UUID

/**
 * 감시 대상 여행 조회 포트(Plan-B 상황 스윕).
 *
 * [TripRepository] 와 따로 두는 이유: 그쪽은 도메인 객체를 한 건·계정 단위로 읽는데, 여기는 **계정을 가로질러**
 * 구간에 걸친 여행을 키셋으로 훑는다 — 목적지·취향까지 실어 올 이유가 없고, 술어가 부분 인덱스
 * `ix_trip_pending_end`(V2.37)와 같아야 한다.
 */
interface TripWatchRepository {
    /** [com.trippilot.trip.api.TripWatchFacade.findOverlapping] 과 같은 뜻. [limit] 는 호출측이 이미 묶었다. */
    fun findOverlapping(from: LocalDate, to: LocalDate, after: UUID?, limit: Int): List<WatchedTrip>
}
