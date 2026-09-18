package com.trippilot.accommodationsearch.adapter.out.persistence

import com.trippilot.accommodationsearch.domain.Money
import com.trippilot.accommodationsearch.domain.StayKey
import com.trippilot.accommodationsearch.domain.StayPriceQueryPort
import org.springframework.data.jpa.repository.JpaRepository
import org.springframework.stereotype.Component

interface StayPriceSnapshotJpaRepository : JpaRepository<StayPriceSnapshotEntity, StayPriceSnapshotId>

/** 최저가 스냅숏 조회 어댑터. 스텁 규모라 findAll 후 필터(실운영은 IN 쿼리로 대체). */
@Component
class StayPriceAdapter(
    private val repo: StayPriceSnapshotJpaRepository,
) : StayPriceQueryPort {

    override fun lowestPrices(keys: List<StayKey>): Map<StayKey, Money> {
        if (keys.isEmpty()) return emptyMap()
        val wanted = keys.toSet()
        return repo.findAll().mapNotNull { e ->
            val k = StayKey(e.externalSource, e.externalId)
            val amount = e.lowestAmount
            if (k in wanted && amount != null) k to Money(amount, e.currency) else null
        }.toMap()
    }
}
