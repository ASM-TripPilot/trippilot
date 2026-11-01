package com.trippilot.auth.adapter.out.persistence

import org.springframework.data.jpa.repository.JpaRepository
import org.springframework.data.jpa.repository.Query
import org.springframework.data.repository.query.Param
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

    /** 트랜잭션 범위 권고 잠금. FROM 절 형태 사유는 `GenerationSessionJpaRepository.advisoryXactLock` 주석과 같다. */
    @Query(value = "SELECT 1 FROM pg_advisory_xact_lock(:namespace, :key)", nativeQuery = true)
    fun advisoryXactLock(@Param("namespace") namespace: Int, @Param("key") key: Int): Int
}

/** marketing_consent — 계정당 1행 upsert. */
interface MarketingConsentJpaRepository : JpaRepository<MarketingConsentJpaEntity, UUID>
