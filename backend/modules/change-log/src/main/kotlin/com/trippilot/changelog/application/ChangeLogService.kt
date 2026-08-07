package com.trippilot.changelog.application

import com.trippilot.changelog.api.AppendChangeLog
import com.trippilot.changelog.api.ChangeLogFacade
import com.trippilot.changelog.api.ChangeSourceType
import com.trippilot.changelog.api.DaySnapshotView
import com.trippilot.changelog.api.ItinerarySnapshotView
import com.trippilot.changelog.api.SlotSnapshotView
import com.trippilot.changelog.domain.ChangeLogEntry
import com.trippilot.changelog.domain.ChangeLogRepository
import com.trippilot.changelog.domain.ChangeSource
import com.trippilot.changelog.domain.DaySnapshot
import com.trippilot.changelog.domain.ItinerarySnapshot
import com.trippilot.changelog.domain.SlotSnapshot
import com.trippilot.core.error.ResourceNotFound
import com.trippilot.trip.api.TripFacade
import org.springframework.stereotype.Service
import java.time.Clock
import java.util.UUID

/**
 * 변경 이력 기록·조회(US-PLANB-09 · TRIP-275).
 * 기록은 **호출자의 트랜잭션에 참여한다**(별도 트랜잭션을 열지 않는다) — 변경과 이력이 함께 커밋되거나
 * 함께 없던 일이 되도록. 기록에 실패하면 변경도 롤백되는 것이 의도된 동작이다.
 */
@Service
class ChangeLogService(
    private val entries: ChangeLogRepository,
    private val trips: TripFacade,
    private val clock: Clock,
) : ChangeLogFacade {

    override fun append(command: AppendChangeLog) {
        entries.append(
            ChangeLogEntry(
                entryId = null,
                tripId = command.tripId,
                actor = command.actor,
                source = command.sourceType.toDomain(),
                reason = command.reason,
                before = command.before.toDomain(),
                after = command.after.toDomain(),
                at = clock.instant(),
            ),
        )
    }

    /**
     * 소유 여행의 이력 타임라인(최신순). 타 계정·없는 여행은 404 로 은닉.
     * 이력은 append-only 라 무한히 쌓이고 한 건이 전후 스냅숏 둘을 담는다 — 반드시 상한을 둔다.
     */
    fun timeline(accountId: UUID, tripId: UUID, limit: Int): List<ChangeLogEntry> {
        trips.findPeriod(accountId, tripId) ?: throw ResourceNotFound()
        return entries.findByTrip(tripId, limit.coerceIn(1, MAX_LIMIT))
    }

    private fun ChangeSourceType.toDomain() = ChangeSource.valueOf(name)

    private fun ItinerarySnapshotView.toDomain() = ItinerarySnapshot(
        days.map { d -> DaySnapshot(d.date, d.slots.map { SlotSnapshot(it.poiId, it.startAt, it.endAt, it.isFixed, it.endsNextDay) }) },
    )

    companion object {
        const val DEFAULT_LIMIT = 100
        const val MAX_LIMIT = 500
    }
}

/** 도메인 → 모듈 경계 표현. (조회는 컨트롤러가 웹 표현으로 다시 옮긴다.) */
fun ItinerarySnapshot.toView(): ItinerarySnapshotView = ItinerarySnapshotView(
    days.map { d -> DaySnapshotView(d.date, d.slots.map { SlotSnapshotView(it.poiId, it.startAt, it.endAt, it.isFixed, it.endsNextDay) }) },
)
