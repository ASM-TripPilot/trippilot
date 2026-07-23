package com.trippilot.auth.adapter.out.persistence

import org.springframework.data.jpa.repository.JpaRepository
import java.time.Instant
import java.util.UUID

/** terms_version — 타입별 현행(effective_at ≤ now 중 최신) + 전체 유효본. */
interface TermsVersionJpaRepository : JpaRepository<TermsVersionJpaEntity, UUID> {
    fun findFirstByTermsTypeAndEffectiveAtLessThanEqualOrderByEffectiveAtDesc(
        termsType: String,
        at: Instant,
    ): TermsVersionJpaEntity?

    fun findByEffectiveAtLessThanEqual(at: Instant): List<TermsVersionJpaEntity>
}

/** consent_record — 계정 증적 전체(폴드용, 최신순). INSERT 는 JpaRepository.save. */
interface ConsentRecordJpaRepository : JpaRepository<ConsentRecordJpaEntity, Long> {
    fun findByAccountIdOrderByOccurredAtDesc(accountId: UUID): List<ConsentRecordJpaEntity>
}

/** marketing_consent — 계정당 1행 upsert. */
interface MarketingConsentJpaRepository : JpaRepository<MarketingConsentJpaEntity, UUID>
