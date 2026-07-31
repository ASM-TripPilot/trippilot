package com.trippilot.trip.application

import com.trippilot.core.error.ConflictDetected
import com.trippilot.core.error.ResourceNotFound
import com.trippilot.placedata.api.PoiSnapshotFacade
import com.trippilot.trip.domain.MustVisit
import com.trippilot.trip.domain.MustVisitRepository
import com.trippilot.trip.domain.MustVisitType
import com.trippilot.trip.domain.Trip
import com.trippilot.trip.domain.TripRepository
import org.springframework.stereotype.Service
import java.time.Clock
import java.time.LocalDate
import java.time.LocalTime
import java.util.UUID

/** 필수 방문지 추가 요청. FIXED면 fixedDate·fixedStart 필수(도메인 검증). dwellMin=체류 희망(솔버 입력). */
data class AddMustVisitCommand(
    val poiId: UUID,
    val type: MustVisitType,
    val fixedDate: LocalDate?,
    val fixedStart: LocalTime?,
    val dwellMin: Int?,
)

/**
 * 필수 방문지(C6). 여행 소유 스코프(타 계정 404) · POI 스냅숏 동결(place-data.api) · (trip,POI) 중복 409.
 * INV-U1-03(동결 참조)·17(FIXED)·18(중복). trip → place-data.api(freeze)는 R1 크로스모듈.
 */
@Service
class MustVisitService(
    private val mustVisits: MustVisitRepository,
    private val trips: TripRepository,
    private val snapshots: PoiSnapshotFacade,
    private val clock: Clock,
) {
    fun add(accountId: UUID, tripId: UUID, cmd: AddMustVisitCommand): MustVisit {
        ownedTrip(accountId, tripId)
        // 중복 먼저(스냅숏 orphan 방지) — sourcePoiId = 담을 POI id.
        if (mustVisits.existsByTripAndSourcePoi(tripId, cmd.poiId)) {
            throw ConflictDetected(message = "이미 추가된 필수 방문지입니다.")
        }
        // ACTIVE POI를 동결(없거나 비-ACTIVE면 404). 스냅숏 참조로 원본 변동에도 안정(INV-U1-03).
        val snap = snapshots.freeze(cmd.poiId) ?: throw ResourceNotFound()
        return mustVisits.save(
            MustVisit.add(
                tripId, snap.poiSnapshotId, snap.sourcePoiId, cmd.type,
                cmd.fixedDate, cmd.fixedStart, cmd.dwellMin, clock.instant(),
            ),
        )
    }

    fun list(accountId: UUID, tripId: UUID): List<MustVisit> {
        ownedTrip(accountId, tripId)
        return mustVisits.findByTrip(tripId)
    }

    fun remove(accountId: UUID, tripId: UUID, mustVisitId: UUID) {
        ownedTrip(accountId, tripId)
        val mv = mustVisits.findById(mustVisitId)?.takeIf { it.tripId == tripId } ?: throw ResourceNotFound()
        mustVisits.delete(mv)
    }

    /** 여행이 없거나 삭제됐거나 타 계정이면 404(존재 은닉). */
    private fun ownedTrip(accountId: UUID, tripId: UUID): Trip =
        trips.findById(tripId)?.takeIf { it.deletedAt == null && it.accountId == accountId } ?: throw ResourceNotFound()
}
