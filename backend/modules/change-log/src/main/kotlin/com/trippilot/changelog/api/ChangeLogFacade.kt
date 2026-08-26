package com.trippilot.changelog.api

import java.time.Instant
import java.time.LocalDate
import java.time.LocalTime
import java.util.UUID

/**
 * 변경 이력 기록 — 타 모듈이 쓰는 유일한 진입점(R1).
 * 편집(itinerary-generation)이 지금 쓰고, Plan-B·어시스턴트가 해당 모듈과 함께 붙는다.
 *
 * 기록은 **변경을 만든 트랜잭션 안에서** 호출한다 — 일정만 바뀌고 이력이 빠지는 상태를 만들지 않기 위해서다.
 */
interface ChangeLogFacade {
    fun append(command: AppendChangeLog)

    /**
     * 소유 여행의 변경 이력 — **최신순**, 최대 [limit] 건(1..500 으로 조여진다).
     * 전량 반환은 없다 — append-only 라 무한히 쌓이고 한 건이 전후 스냅숏 둘을 담는다.
     *
     * 이력이 없으면 **빈 목록**이다(오류가 아니다). 없거나 타 계정 여행이면
     * `ResourceNotFound` — 존재 은닉 판정을 소비 모듈이 되풀이하지 않도록 소유 모듈이 낸다(HTTP 경로와 같은 판정).
     *
     * 소비자가 테이블을 직접 읽지 않는 이유(DEC-U5-8): `change_log_entry` 는 append-only 계약이 DB 권한으로
     * 걸린 테이블이라, 밖에서 SQL 로 잡으면 그 계약을 지키는 자리가 흩어진다.
     */
    fun findTimeline(accountId: UUID, tripId: UUID, limit: Int): List<ChangeLogEntryView>
}

/**
 * 이력 한 건(모듈 경계 표현) — 전후 장소·사유·시각이 한 줄에 함께 온다(BR-U5-30).
 * 내부 식별자(IDENTITY)는 싣지 않는다 — 소비처가 필요로 하지 않고, 전 플랫폼 단조 증가라 편집량이 새어 나간다.
 */
data class ChangeLogEntryView(
    val actor: String,
    val sourceType: ChangeSourceType,
    val reason: String?,
    val at: Instant,
    val before: ItinerarySnapshotView,
    val after: ItinerarySnapshotView,
)

/**
 * [reason] 은 선택 — 수동 편집은 사유 없이 저장될 수 있다(Plan-B 는 트리거 사유를 싣는다).
 * [before]/[after] 는 변경 전후 스냅숏 전체다(편집이 전체 교체라 부분 diff 가 아니라 스냅숏으로 남긴다).
 */
data class AppendChangeLog(
    val tripId: UUID,
    val actor: String,
    val sourceType: ChangeSourceType,
    val reason: String?,
    val before: ItinerarySnapshotView,
    val after: ItinerarySnapshotView,
)

/** 변경 출처(모듈 경계 표현). 도메인 [com.trippilot.changelog.domain.ChangeSource] 와 1:1. */
enum class ChangeSourceType { PLAN_B, MANUAL, COEDIT, ASSISTANT }

/** 전후 스냅숏(모듈 경계 표현) — 시각·순서만(INV-3 소요시간 없음). */
data class ItinerarySnapshotView(val days: List<DaySnapshotView>)
data class DaySnapshotView(val date: LocalDate, val slots: List<SlotSnapshotView>)
data class SlotSnapshotView(
    val poiId: UUID,
    val startAt: LocalTime,
    val endAt: LocalTime,
    val isFixed: Boolean,
    val endsNextDay: Boolean,
)
