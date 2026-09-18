package com.trippilot.trip.domain

import java.time.Instant
import java.time.LocalDate
import java.util.UUID

/**
 * 여행 종료 기록 포트(TRIP-554).
 *
 * [TripRepository] 와 따로 두는 이유는 **조건부 쓰기**가 필요해서다 — 도메인 객체를 읽어 저장하면
 * 읽고-검사-쓰기 사이에 다른 인스턴스가 끼어들어 같은 여행에 이벤트가 두 번 나간다.
 */
interface TripEndRepository {
    /** 종료일이 지났는데 아직 기록되지 않은 여행. 삭제된 여행은 제외한다 — 알릴 사람이 없다. */
    fun findEndedButUnmarked(today: LocalDate, limit: Int): List<UUID>

    /** 조건부 쓰기 — 이미 찍혀 있으면 false. 이것이 "한 번만 발행"의 전부다. */
    fun markEnded(tripId: UUID, at: Instant): Boolean
}
