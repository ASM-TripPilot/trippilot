package com.trippilot.changelog.api

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
}

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
