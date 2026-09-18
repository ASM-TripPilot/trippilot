package com.trippilot.trip.application

import com.trippilot.trip.domain.Trip
import com.trippilot.trip.domain.TripAggregatePort
import com.trippilot.trip.domain.TripCounts
import com.trippilot.trip.domain.TripDateRange
import org.springframework.stereotype.Service
import java.util.UUID

/**
 * 여행 카드 집계 조회(BR-U6-22).
 *
 * [TripService] 에 얹지 않은 이유는 파급이다 — 그쪽 생성자에 포트를 하나 더 달면 여행 생성·수정·삭제를
 * 검증하는 기존 테스트가 전부 그 대역을 만들어야 한다. 집계는 읽기 전용이고 쓰는 곳도 목록 표면뿐이라
 * 따로 둔다.
 */
@Service
class TripCountsService(private val aggregates: TripAggregatePort) {

    /** 여행이 없으면 포트를 부르지 않는다 — 빈 목록을 물으러 나가지 않는다. */
    fun of(accountId: UUID, trips: List<Trip>): Map<UUID, TripCounts> {
        if (trips.isEmpty()) return emptyMap()
        return aggregates.countsOf(
            accountId,
            trips.map { TripDateRange(it.tripId, it.startDate, it.endDate) },
        )
    }
}
