package com.trippilot.itinerarygeneration.domain

import com.trippilot.core.error.ConflictDetected
import com.trippilot.core.error.FieldError
import com.trippilot.core.error.ValidationFailed
import java.time.Instant
import java.time.LocalDate
import java.time.LocalTime
import java.util.UUID

/** 일정 상태. PLANNED→CONFIRMED 단방향(확정 후 읽기전용 잠금). */
enum class ItineraryStatus { PLANNED, CONFIRMED }

/**
 * 솔버 산출 방식. AI 실패 시 폴백 단계 표시(INV-4).
 * **품질 높은 순으로 선언**(뒤일수록 저하) — 2단계 생성이 두 호출의 등급을 합칠 때 이 순서를 쓴다.
 */
enum class SolveMode { FULL_AI, DETERMINISTIC, MINIMAL }

/**
 * 생성 진행 상태 — day1 조기 노출(2단계 호출) 대비 계약. 확정 상태([ItineraryStatus])와는 **다른 축**.
 * PARTIAL=1차(day1)만 채워짐 · COMPLETE=전 일자 완료 · FAILED=2차 결과 반영 실패(1차분은 유효).
 * PARTIAL 인 동안 확정·편집은 409 — 2차 결과가 사용자의 변경을 덮어쓰지 못하게 한다.
 */
enum class GenerationState { PARTIAL, COMPLETE, FAILED }

/**
 * 방문 슬롯 — 솔버가 검증한 시각·순서만 담는다(INV-2). **소요시간(duration) 필드 없음(INV-3, 타입으로 보장)** — 거리만 표시.
 * [poiSnapshotId]는 확정 시 동결(INV-U1-03) — PLANNED 동안 null; [sourcePoiId](생성 시점 POI)는 항상 존재.
 */
class VisitSlot private constructor(
    val sourcePoiId: UUID,
    val poiSnapshotId: UUID?,
    val orderIndex: Int,
    val startAt: LocalTime,
    val endAt: LocalTime,
    val isFixed: Boolean,
    val hasViolation: Boolean,
    val endsNextDay: Boolean,   // 자정 넘김(HC4) — true 면 endAt(익일 시각) < startAt 허용
    /**
     * 직전 지점에서 이 슬롯까지의 이동 **거리 표시 문자열**(BR-U2-08) — 예 "약 1.2km · 도보 추정".
     * 소요시간은 어떤 이유로도 담지 않는다(INV-3). 직선거리 폴백이면 "추정" 표기가 문자열에 포함된다.
     */
    val distanceRange: String?,
    /** 추천 이유(BR-U2-04). 시각·소요시간 언급 없음(BR-U2-09) — 문구 집행은 AI 책임. */
    val placementReason: String?,
    /**
     * 위반 사유(BR-U3-13). [hasViolation] 이 true 일 때만 값이 있다.
     * 배지만 남기면 저장 후 재조회에서 "무엇이 왜 문제인지"가 사라진다 — 지속 가시화가 요건이다.
     */
    val violationReason: String?,
) {
    companion object {
        fun of(
            sourcePoiId: UUID,
            poiSnapshotId: UUID?,
            orderIndex: Int,
            startAt: LocalTime,
            endAt: LocalTime,
            isFixed: Boolean = false,
            hasViolation: Boolean = false,
            endsNextDay: Boolean = false,
            distanceRange: String? = null,
            placementReason: String? = null,
            violationReason: String? = null,
        ): VisitSlot {
            val errors = mutableListOf<FieldError>()
            if (orderIndex < 0) errors += FieldError("orderIndex", "순서는 0 이상입니다.")
            // 자정 넘김이면 endAt 이 익일 시각이라 startAt 보다 작을 수 있음(HC4) — 그 경우만 허용.
            if (endAt < startAt && !endsNextDay) errors += FieldError("endAt", "종료 시각은 시작 이후여야 합니다.")
            if (errors.isNotEmpty()) throw ValidationFailed(errors)
            return VisitSlot(sourcePoiId, poiSnapshotId, orderIndex, startAt, endAt, isFixed, hasViolation, endsNextDay, distanceRange, placementReason, violationReason)
        }
    }
}

/** 하루 일정 — 날짜 + 방문 슬롯(순서 오름차순 정렬 보장). */
class ItineraryDay private constructor(
    val date: LocalDate,
    val dayOrder: Int,
    val slots: List<VisitSlot>,
) {
    companion object {
        fun of(date: LocalDate, dayOrder: Int, slots: List<VisitSlot>): ItineraryDay {
            val errors = mutableListOf<FieldError>()
            if (dayOrder < 0) errors += FieldError("dayOrder", "일자 순서는 0 이상입니다.")
            if (slots.map { it.orderIndex }.toSet().size != slots.size) {
                errors += FieldError("slots", "슬롯 순서(orderIndex)는 중복될 수 없습니다.")
            }
            if (errors.isNotEmpty()) throw ValidationFailed(errors)
            return ItineraryDay(date, dayOrder, slots.sortedBy { it.orderIndex })
        }
    }
}

/**
 * 일정(C8) 애그리거트 — 생성 결과 영속·확정. 사용자에게 보이는 시각·순서는 솔버 검증값만(INV-2).
 * 확정(PLANNED→CONFIRMED)은 단방향 잠금이고, poi_snapshot 동결은 확정 서비스(BE-7/272)가 수행한다.
 */
class Itinerary private constructor(
    val itineraryId: UUID,
    val tripId: UUID,
    val status: ItineraryStatus,
    val solveMode: SolveMode,
    /** 사용자가 고른 생성 방식. [solveMode](AI 가 어떻게 풀었나)와 다른 축이다. */
    val generationMode: GenerationMode,
    val isFallback: Boolean,
    val generationState: GenerationState,
    val days: List<ItineraryDay>,
    val createdAt: Instant,
    val updatedAt: Instant,
    /**
     * 후보 충분성(BR-U2-05) — AI 판정값을 그대로 보관·전달. 백엔드는 재계산하지 않는다.
     * 생성자·[reconstitute] 모두 기본값을 두지 않는다 — 전이 진입점에 기본값이 있으면 호출자가 그냥 빠뜨리고
     * 값이 조용히 사라진다(실제로 편집 경로에서 그렇게 유실됐다. endsNextDay·distanceRange 에 이은 세 번째).
     */
    val candidatesSummary: CandidatesSummary?,
) {
    /** 확정 — PLANNED + 생성 완료만 가능(이미 확정이거나 생성 중이면 409). 상태 전이만(동결 없음). */
    fun confirm(now: Instant): Itinerary {
        requireConfirmable()
        return Itinerary(itineraryId, tripId, ItineraryStatus.CONFIRMED, solveMode, generationMode, isFallback, generationState, days, createdAt, now, candidatesSummary)
    }

    /**
     * 확정 + poi_snapshot 동결(INV-U1-03) — 각 슬롯 sourcePoiId 를 동결 스냅숏 id 로 세팅. 이미 확정이면 409.
     * [snapshotByPoi] 는 전 슬롯 POI 를 덮어야 한다(호출 서비스가 freeze 로 완비 후 전달).
     */
    fun confirm(snapshotByPoi: Map<UUID, UUID>, now: Instant): Itinerary {
        requireConfirmable()
        val frozenDays = days.map { d ->
            ItineraryDay.of(
                d.date, d.dayOrder,
                d.slots.map { s ->
                    VisitSlot.of(
                        s.sourcePoiId, snapshotByPoi.getValue(s.sourcePoiId), s.orderIndex,
                        // 동결은 스냅숏 참조만 붙이는 것 — 표시값은 **전부 그대로 옮긴다**.
                        // 하나라도 빠뜨리면 확정하는 순간 조용히 사라진다(endsNextDay 로 이미 겪은 회귀).
                        s.startAt, s.endAt, s.isFixed, s.hasViolation, s.endsNextDay, s.distanceRange, s.placementReason,
                        s.violationReason,
                    )
                },
            )
        }
        return Itinerary(itineraryId, tripId, ItineraryStatus.CONFIRMED, solveMode, generationMode, isFallback, generationState, frozenDays, createdAt, now, candidatesSummary)
    }

    /**
     * 확정 가능 조건 — PLANNED(단방향 잠금) **AND** 생성 완료.
     * 생성 중(PARTIAL)에 확정하면 day1 만 동결된 채 잠겨(INV-U1-03) 2차 결과를 반영할 수 없다 → 409.
     */
    private fun requireConfirmable() {
        if (status != ItineraryStatus.PLANNED) throw ConflictDetected(message = "이미 확정된 일정입니다.")
        if (generationState == GenerationState.PARTIAL) {
            throw ConflictDetected(message = "일정 생성이 진행 중입니다. 완료 후 확정할 수 있습니다.")
        }
    }

    /**
     * 2차 생성 완료 — 전 일자를 채우고 COMPLETE 로 전이(PARTIAL 에서만). identity·createdAt·확정상태는 보존.
     * U5 2단계 호출의 완료 콜백이 쓴다 — [reconstitute] 를 직접 호출하면 status 를 실수로 되돌릴 수 있어 이 경로를 둔다.
     */
    fun completeGeneration(
        allDays: List<ItineraryDay>,
        now: Instant,
        secondSolveMode: SolveMode = solveMode,
        secondIsFallback: Boolean = isFallback,
        secondCandidatesSummary: CandidatesSummary? = null,
    ): Itinerary {
        if (generationState != GenerationState.PARTIAL) {
            throw ConflictDetected(message = "생성 중인 일정이 아닙니다.")
        }
        if (allDays.map { it.dayOrder }.toSet().size != allDays.size) {
            throw ValidationFailed(listOf(FieldError("days", "일자 순서(dayOrder)는 중복될 수 없습니다.")))
        }
        return Itinerary(
            // 두 호출의 품질이 다르면 **낮은 쪽**을 기록한다 — 2차가 폴백으로 떨어졌는데 FULL_AI 로 남으면
            // 저하가 사용자·운영에 감춰진다(INV-4 침묵 금지).
            itineraryId, tripId, status, maxOf(solveMode, secondSolveMode), generationMode, isFallback || secondIsFallback,
            GenerationState.COMPLETE, allDays.sortedBy { it.dayOrder }, createdAt, now,
            // 2차가 요약을 주면 그 값(전 일자 기준), 없으면 1차 값 유지
            secondCandidatesSummary ?: candidatesSummary,
        )
    }

    /** 2차 생성 실패 — 1차분(day1)은 유효하게 두고 FAILED 로 전이(PARTIAL 에서만). 침묵 실패 금지(INV-4). */
    fun failGeneration(now: Instant): Itinerary {
        if (generationState != GenerationState.PARTIAL) {
            throw ConflictDetected(message = "생성 중인 일정이 아닙니다.")
        }
        return Itinerary(
            itineraryId, tripId, status, solveMode, generationMode, isFallback, GenerationState.FAILED, days, createdAt, now,
            candidatesSummary,
        )
    }

    companion object {
        fun create(
            tripId: UUID,
            solveMode: SolveMode,
            generationMode: GenerationMode,
            isFallback: Boolean,
            days: List<ItineraryDay>,
            now: Instant,
            generationState: GenerationState = GenerationState.COMPLETE, // 단일 호출=완료. 2단계(day1)는 PARTIAL
            candidatesSummary: CandidatesSummary? = null,
        ): Itinerary {
            if (days.map { it.dayOrder }.toSet().size != days.size) {
                throw ValidationFailed(listOf(FieldError("days", "일자 순서(dayOrder)는 중복될 수 없습니다.")))
            }
            return Itinerary(
                UUID.randomUUID(), tripId, ItineraryStatus.PLANNED, solveMode, generationMode, isFallback, generationState,
                days.sortedBy { it.dayOrder }, now, now, candidatesSummary,
            )
        }

        @Suppress("LongParameterList")
        fun reconstitute(
            itineraryId: UUID, tripId: UUID, status: ItineraryStatus, solveMode: SolveMode,
            generationMode: GenerationMode, isFallback: Boolean, generationState: GenerationState, days: List<ItineraryDay>,
            createdAt: Instant, updatedAt: Instant, candidatesSummary: CandidatesSummary?,
        ): Itinerary = Itinerary(
            itineraryId, tripId, status, solveMode, generationMode, isFallback, generationState,
            days.sortedBy { it.dayOrder }, createdAt, updatedAt, candidatesSummary,
        )
    }
}

/** 일정 영속 포트. 애그리거트 단위 저장·조회(days·slots 포함). */
interface ItineraryRepository {
    fun save(itinerary: Itinerary): Itinerary
    fun findById(itineraryId: UUID): Itinerary?
    fun findByTrip(tripId: UUID): List<Itinerary>

    /** 여행의 현행 일정을 교체(원자적) — 재생성 시 기존 제거 후 저장. 여행당 1개 유지. */
    fun replaceForTrip(tripId: UUID, itinerary: Itinerary): Itinerary

    /**
     * 현행 일정이 [expectedItineraryId] 이고 아직 [GenerationState.PARTIAL] 일 때만 교체한다(조건부 쓰기).
     * 백그라운드 2차 생성이 쓰는 경로 — 읽고-쓰는 사이에 재생성이 끼어들면 삭제 키가 `trip_id` 라
     * 방금 만들어진 일정까지 지워버린다. 교체 여부를 **DB 조건**으로 판정해 그 창을 없앤다.
     * @return 교체했으면 true, 조건이 깨져 아무것도 하지 않았으면 false.
     */
    fun replaceIfCurrent(tripId: UUID, expectedItineraryId: UUID, itinerary: Itinerary): Boolean

    /** [Instant] 이전에 마지막으로 갱신된 채 아직 PARTIAL 인 일정 — 중단된 2차 생성을 찾는 용도. */
    fun findStalePartial(updatedBefore: Instant): List<Itinerary>
}
