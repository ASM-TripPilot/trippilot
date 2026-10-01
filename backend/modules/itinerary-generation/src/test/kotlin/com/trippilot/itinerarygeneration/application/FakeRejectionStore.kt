package com.trippilot.itinerarygeneration.application

import com.trippilot.itinerarygeneration.domain.RejectedPoi
import com.trippilot.itinerarygeneration.domain.RejectionStore
import java.util.UUID

/**
 * 인메모리 거절 저장소 — 서비스 로직(무엇을·언제 기록하고 어디에 싣는가)용 대역.
 * upsert 의 원자성(경합 시 행 분열 없음)은 여기서 못 본다 — 그건 실 DB IT 몫이다.
 */
class FakeRejectionStore : RejectionStore {
    val byTrip = mutableMapOf<UUID, MutableMap<Pair<UUID, RejectedPoi.Kind>, Int>>()

    override fun record(tripId: UUID, poiIds: Collection<UUID>, kind: RejectedPoi.Kind) {
        if (poiIds.isEmpty()) return
        val m = byTrip.getOrPut(tripId) { mutableMapOf() }
        poiIds.distinct().forEach { m.merge(it to kind, 1, Int::plus) }
    }

    override fun findByTrip(tripId: UUID): List<RejectedPoi> =
        byTrip[tripId].orEmpty().map { (k, c) -> RejectedPoi(k.first, k.second, c) }
}
