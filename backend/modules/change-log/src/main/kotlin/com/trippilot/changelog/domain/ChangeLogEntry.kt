package com.trippilot.changelog.domain

import java.time.Instant
import java.time.LocalDate
import java.time.LocalTime
import java.util.UUID

/**
 * 변경 이력 한 건 — **append-only**: 앱은 개별 행을 수정·삭제할 수 없다(DB 권한으로도 회수, V2.11).
 * "이날 무엇을 왜 바꿨는지"를 되짚기 위한 기록이라, 남은 뒤에는 바뀌지 않는 것이 요건이다.
 * 단 여행이 삭제되면 이력도 함께 지워진다(여행에 딸린 사용자 데이터 — 법정 보존 로그와 다르다).
 */
data class ChangeLogEntry(
    val entryId: Long?, // 영속 전 null (DB IDENTITY)
    val tripId: UUID,
    val actor: String,
    val source: ChangeSource,
    val reason: String?,
    val before: ItinerarySnapshot,
    val after: ItinerarySnapshot,
    val at: Instant,
)

/** 변경 출처. PLAN_B=자동 재계획 · MANUAL=사용자 편집 · COEDIT=공동 편집 · ASSISTANT=AI 도우미. */
enum class ChangeSource { PLAN_B, MANUAL, COEDIT, ASSISTANT }

/**
 * 변경 전후 일정 스냅숏 — 시각·순서만(INV-3 소요시간 없음).
 * 모듈 경계 DTO(api)·REST 응답·저장 형식과 **분리된 타입**이다. 하나로 겸하면 여기에 필드를 더하는 순간
 * 공개 API 응답과 jsonb 저장 형식이 소리 없이 같이 바뀐다.
 */
data class ItinerarySnapshot(val days: List<DaySnapshot>)
data class DaySnapshot(val date: LocalDate, val slots: List<SlotSnapshot>)
data class SlotSnapshot(
    val poiId: UUID,
    val startAt: LocalTime,
    val endAt: LocalTime,
    val isFixed: Boolean,
    val endsNextDay: Boolean,
)

interface ChangeLogRepository {
    fun append(entry: ChangeLogEntry): ChangeLogEntry

    /** 여행의 이력 — 최신순, 최대 [limit] 건. 타임라인 조회용. */
    fun findByTrip(tripId: UUID, limit: Int): List<ChangeLogEntry>
}
