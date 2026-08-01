package com.trippilot.trip.domain

import com.trippilot.core.error.FieldError
import com.trippilot.core.error.ValidationFailed
import java.time.Instant
import java.time.LocalDate
import java.time.LocalTime
import java.util.UUID

/** 필수 방문지 유형. FIXED는 날짜·시각 고정(INV-U1-17). */
enum class MustVisitType { ANYTIME, FIXED }

/**
 * 필수 방문지(C6) — 여행에 반드시 넣을 장소. poi_snapshot(동결 사본) 참조(INV-U1-03).
 * 불변식 INV-U1-17: FIXED면 fixedDate·fixedStart 필수. 중복(trip, sourcePoi) 금지는 서비스+DB(INV-U1-18).
 */
class MustVisit private constructor(
    val mustVisitId: UUID,
    val tripId: UUID,
    val poiSnapshotId: UUID,
    val sourcePoiId: UUID,
    val type: MustVisitType,
    val fixedDate: LocalDate?,
    val fixedStart: LocalTime?,
    val dwellMin: Int?,
    val createdAt: Instant,
) {
    companion object {
        fun add(
            tripId: UUID,
            poiSnapshotId: UUID,
            sourcePoiId: UUID,
            type: MustVisitType,
            fixedDate: LocalDate?,
            fixedStart: LocalTime?,
            dwellMin: Int?,
            now: Instant,
        ): MustVisit {
            val errors = mutableListOf<FieldError>()
            if (type == MustVisitType.FIXED && (fixedDate == null || fixedStart == null)) {
                errors += FieldError("fixed", "고정(FIXED) 필수 방문지는 날짜·시각이 필요합니다.") // INV-U1-17
            }
            if (type == MustVisitType.ANYTIME && (fixedDate != null || fixedStart != null)) {
                // 자유 배치인데 고정 시각이 실리면 솔버(INV-2)가 시각 고정으로 오해 — 모순 데이터 차단.
                errors += FieldError("fixed", "자유(ANYTIME) 필수 방문지에는 고정 날짜·시각을 넣을 수 없습니다.")
            }
            if (dwellMin != null && dwellMin < 0) errors += FieldError("dwellMin", "체류 시간은 0 이상입니다.")
            if (errors.isNotEmpty()) throw ValidationFailed(errors)
            return MustVisit(UUID.randomUUID(), tripId, poiSnapshotId, sourcePoiId, type, fixedDate, fixedStart, dwellMin, now)
        }

        @Suppress("LongParameterList")
        fun reconstitute(
            mustVisitId: UUID, tripId: UUID, poiSnapshotId: UUID, sourcePoiId: UUID, type: MustVisitType,
            fixedDate: LocalDate?, fixedStart: LocalTime?, dwellMin: Int?, createdAt: Instant,
        ): MustVisit = MustVisit(mustVisitId, tripId, poiSnapshotId, sourcePoiId, type, fixedDate, fixedStart, dwellMin, createdAt)
    }
}

/** 필수 방문지 영속 포트. (trip, sourcePoi) 유일·소유 스코프 인가는 서비스가. */
interface MustVisitRepository {
    fun save(mustVisit: MustVisit): MustVisit
    fun findByTrip(tripId: UUID): List<MustVisit>
    fun findById(mustVisitId: UUID): MustVisit?
    fun existsByTripAndSourcePoi(tripId: UUID, sourcePoiId: UUID): Boolean
    fun delete(mustVisit: MustVisit)
}
