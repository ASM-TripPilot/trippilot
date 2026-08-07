package com.trippilot.changelog.domain

import com.trippilot.changelog.api.ChangeSourceType
import com.trippilot.changelog.api.ItinerarySnapshotView
import java.time.Instant
import java.util.UUID

/**
 * 변경 이력 한 건 — **append-only**(수정·삭제 없음, DB 권한으로도 회수: V2.11).
 * "이날 무엇을 왜 바꿨는지"를 되짚기 위한 기록이라, 남은 뒤에는 바뀌지 않는 것이 요건이다.
 */
data class ChangeLogEntry(
    val entryId: Long?, // 영속 전 null (DB IDENTITY)
    val tripId: UUID,
    val actor: String,
    val sourceType: ChangeSourceType,
    val reason: String?,
    val before: ItinerarySnapshotView,
    val after: ItinerarySnapshotView,
    val at: Instant,
)

interface ChangeLogRepository {
    fun append(entry: ChangeLogEntry): ChangeLogEntry

    /** 여행의 이력 — 최신순. 타임라인 조회용. */
    fun findByTrip(tripId: UUID): List<ChangeLogEntry>
}
