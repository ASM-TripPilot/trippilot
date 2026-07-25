package com.trippilot.accommodationsearch.config

import com.trippilot.accommodationsearch.application.PriceSnapshotBatch
import org.springframework.boot.ApplicationRunner
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Configuration

/**
 * 스텁 단계 편의: 기동 시 최저가 스냅숏을 1회 채운다(PK upsert — idempotent).
 * 실운영은 @Scheduled(일1회) + ShedLock(U0 자산)으로 대체 — 이 시더는 스텁 한정.
 */
@Configuration
class AccommodationSearchConfiguration {
    @Bean
    fun stubPriceSnapshotSeeder(batch: PriceSnapshotBatch) = ApplicationRunner { batch.refresh() }
}
