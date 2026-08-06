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

/** 솔버 산출 방식. AI 실패 시 폴백 단계 표시(INV-4). */
enum class SolveMode { FULL_AI, DETERMINISTIC, MINIMAL }

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
        ): VisitSlot {
            val errors = mutableListOf<FieldError>()
            if (orderIndex < 0) errors += FieldError("orderIndex", "순서는 0 이상입니다.")
            // 자정 넘김이면 endAt 이 익일 시각이라 startAt 보다 작을 수 있음(HC4) — 그 경우만 허용.
            if (endAt < startAt && !endsNextDay) errors += FieldError("endAt", "종료 시각은 시작 이후여야 합니다.")
            if (errors.isNotEmpty()) throw ValidationFailed(errors)
            return VisitSlot(sourcePoiId, poiSnapshotId, orderIndex, startAt, endAt, isFixed, hasViolation, endsNextDay)
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
    val isFallback: Boolean,
    val days: List<ItineraryDay>,
    val createdAt: Instant,
    val updatedAt: Instant,
) {
    /** 확정 — PLANNED만 가능(이미 CONFIRMED면 409). */
    fun confirm(now: Instant): Itinerary {
        if (status != ItineraryStatus.PLANNED) throw ConflictDetected(message = "이미 확정된 일정입니다.")
        return Itinerary(itineraryId, tripId, ItineraryStatus.CONFIRMED, solveMode, isFallback, days, createdAt, now)
    }

    companion object {
        fun create(
            tripId: UUID,
            solveMode: SolveMode,
            isFallback: Boolean,
            days: List<ItineraryDay>,
            now: Instant,
        ): Itinerary {
            if (days.map { it.dayOrder }.toSet().size != days.size) {
                throw ValidationFailed(listOf(FieldError("days", "일자 순서(dayOrder)는 중복될 수 없습니다.")))
            }
            return Itinerary(
                UUID.randomUUID(), tripId, ItineraryStatus.PLANNED, solveMode, isFallback,
                days.sortedBy { it.dayOrder }, now, now,
            )
        }

        @Suppress("LongParameterList")
        fun reconstitute(
            itineraryId: UUID, tripId: UUID, status: ItineraryStatus, solveMode: SolveMode,
            isFallback: Boolean, days: List<ItineraryDay>, createdAt: Instant, updatedAt: Instant,
        ): Itinerary = Itinerary(
            itineraryId, tripId, status, solveMode, isFallback, days.sortedBy { it.dayOrder }, createdAt, updatedAt,
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
}
