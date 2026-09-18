package com.trippilot.itinerarygeneration.domain

import java.time.Instant
import java.util.UUID

/**
 * 되돌리기 지점 1건(DEC-U3-1 · domain-entities §2.1).
 * U3 가 소유하는 이력은 **사용자 편집 + AI 생성 기준 버전**뿐이다 — Plan-B 재계획은 U4, 아카이브는 U5(C12).
 *
 * [seq] 는 **여행 안에서** 유일·단조(INV-U3-06). 되돌리기도 새 리비전을 쌓는다(과거 삭제 금지, BR-U3-32).
 * 정본은 일정 기준이지만, 이 코드베이스는 편집·재생성마다 itinerary 행을 새로 만들어(replaceForTrip)
 * 일정에 매달면 이력이 끊긴다 — [itineraryId] 는 "어느 일정의 버전이었나"를 남기는 참고 값이다(V2.14 주석).
 */
data class ItineraryRevision(
    val revisionId: UUID,
    val tripId: UUID,
    val itineraryId: UUID,
    val seq: Int,
    val actor: RevisionActor,
    val kind: RevisionKind,
    val summary: String,
    val detail: String?,
    val snapshot: ItinerarySnapshot,
    val createdAt: Instant,
)

/** 화면의 `나`/`AI` 배지. */
enum class RevisionActor { USER, AI }

/** BR-U3-31 — 이 4종뿐이다. BASELINE = "AI 가 처음 짠 일정 · 기준 버전". */
enum class RevisionKind { BASELINE, GENERATE, EDIT, RESTORE }

/** 복원용 일정 스냅숏 — 표시값 전부를 담는다(하나라도 빠지면 되돌린 순간 그 값이 사라진다). */
data class ItinerarySnapshot(val days: List<DaySnapshot>)
data class DaySnapshot(val date: java.time.LocalDate, val slots: List<SlotSnapshot>)
data class SlotSnapshot(
    val poiId: UUID,
    val startAt: java.time.LocalTime,
    val endAt: java.time.LocalTime,
    val isFixed: Boolean,
    val endsNextDay: Boolean,
    val distanceRange: String?,
    val placementReason: String?,
)

/**
 * 목록 표시용 — **스냅숏을 담지 않는다**. 목록은 문구·주체·시각만 쓰는데 스냅숏까지 역직렬화하면
 * 편집 200번한 여행에서 일정 200개를 파싱해 버리는 셈이다(되돌리기는 서버가 단건으로 읽는다).
 */
data class ItineraryRevisionSummary(
    val revisionId: UUID,
    val seq: Int,
    val actor: RevisionActor,
    val kind: RevisionKind,
    val summary: String,
    val detail: String?,
    val createdAt: Instant,
)

interface ItineraryRevisionRepository {
    /** [ItineraryRevision.seq] 는 구현이 채운다(여행 기준 현재 최대+1). 동시 기록은 UNIQUE 제약이 막는다. */
    fun append(revision: NewRevision): ItineraryRevision

    /** 여행의 리비전 목록 — 최신순, 최대 [limit] 건. 스냅숏은 싣지 않는다. */
    fun findSummaries(tripId: UUID, limit: Int): List<ItineraryRevisionSummary>

    /** 되돌리기 지점이 하나라도 있는가 — 없으면 만들어야 한다(INV-U3-08). */
    fun existsForTrip(tripId: UUID): Boolean

    fun findById(revisionId: UUID): ItineraryRevision?
}

/** seq 미정 상태의 기록 요청 — seq 부여는 저장소가 한다. */
data class NewRevision(
    val tripId: UUID,
    val itineraryId: UUID,
    val actor: RevisionActor,
    val kind: RevisionKind,
    val summary: String,
    val detail: String?,
    val snapshot: ItinerarySnapshot,
    val createdAt: Instant,
)
