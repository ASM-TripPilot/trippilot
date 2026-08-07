package com.trippilot.changelog.application

import com.trippilot.changelog.api.AppendChangeLog
import com.trippilot.changelog.api.ChangeLogFacade
import com.trippilot.changelog.domain.ChangeLogEntry
import com.trippilot.changelog.domain.ChangeLogRepository
import com.trippilot.core.error.ResourceNotFound
import com.trippilot.trip.api.TripFacade
import org.springframework.stereotype.Service
import java.time.Clock
import java.util.UUID

/**
 * 변경 이력 기록·조회(US-PLANB-09 · TRIP-275).
 * 기록은 호출자의 트랜잭션에 참여한다(별도 트랜잭션을 열지 않는다) — 변경과 이력이 함께 커밋되거나 함께 없던 일이 되도록.
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
                sourceType = command.sourceType,
                reason = command.reason,
                before = command.before,
                after = command.after,
                at = clock.instant(),
            ),
        )
    }

    /** 소유 여행의 이력 타임라인(최신순). 타 계정·없는 여행은 404 로 은닉. */
    fun timeline(accountId: UUID, tripId: UUID): List<ChangeLogEntry> {
        trips.findPeriod(accountId, tripId) ?: throw ResourceNotFound()
        return entries.findByTrip(tripId)
    }
}
