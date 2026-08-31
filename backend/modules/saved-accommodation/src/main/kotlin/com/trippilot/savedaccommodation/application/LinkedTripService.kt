package com.trippilot.savedaccommodation.application

import com.trippilot.savedaccommodation.domain.BaseAssignmentRepository
import com.trippilot.savedaccommodation.domain.SavedStay
import com.trippilot.trip.api.TripLivenessFacade
import org.springframework.stereotype.Service
import java.util.UUID

/**
 * 숙소 → 연결 여행(BR-U6-20 · `l04`).
 *
 * 배정(`base_assignment`)은 **이 모듈 것**이라 여행 모듈을 거치지 않고 바로 읽는다. 다만
 * 배정 행은 여행이 소프트 삭제돼도 남으므로, **살아 있는 여행만** 남긴다 — 안 그러면 지운 여행이
 * 숙소 행에 계속 붙어 있고 사용자는 그것을 열 수 없다.
 */
@Service
class LinkedTripService(
    private val bases: BaseAssignmentRepository,
    private val trips: TripLivenessFacade,
) {
    /** 숙소마다 따로 묻지 않는다 — 두 번의 조회로 목록 전체를 채운다. */
    fun of(accountId: UUID, stays: List<SavedStay>): Map<UUID, List<UUID>> {
        if (stays.isEmpty()) return emptyMap()
        val byStay = bases.findTripIdsByStays(stays.map { it.savedStayId })
        if (byStay.isEmpty()) return emptyMap()
        val live = trips.filterLiveTrips(accountId, byStay.values.flatten().toSet())
        return byStay.mapValues { (_, tripIds) -> tripIds.filter { it in live } }
            .filterValues { it.isNotEmpty() }
    }
}
