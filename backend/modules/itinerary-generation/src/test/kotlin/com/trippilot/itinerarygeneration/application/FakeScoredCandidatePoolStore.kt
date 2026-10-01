package com.trippilot.itinerarygeneration.application

import com.trippilot.itinerarygeneration.domain.ScoredCandidatePool
import com.trippilot.itinerarygeneration.domain.ScoredCandidatePoolStore
import java.util.UUID

/** 인메모리 점수 후보 풀(TRIP-969) — 실 구현과 같은 갈아끼움·합치기 의미론([FakeRejectionStore] 선례). */
class FakeScoredCandidatePoolStore : ScoredCandidatePoolStore {

    val pools = mutableMapOf<UUID, ScoredCandidatePool>()

    override fun replace(tripId: UUID, pool: ScoredCandidatePool) {
        pools[tripId] = pool.capped()
    }

    override fun merge(tripId: UUID, pool: ScoredCandidatePool) {
        val existing = pools[tripId] ?: return replace(tripId, pool)
        val combined = (existing.candidates.associateBy { it.poiId } + pool.candidates.associateBy { it.poiId })
            .values.toList()
        replace(tripId, ScoredCandidatePool(maxOf(existing.radiusM, pool.radiusM), combined))
    }

    override fun delete(tripId: UUID) {
        pools.remove(tripId)
    }

    override fun find(tripId: UUID): ScoredCandidatePool? = pools[tripId]
}
