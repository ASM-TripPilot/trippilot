package com.trippilot.auth.adapter.out.persistence

import com.trippilot.auth.domain.AccountId
import com.trippilot.auth.domain.consent.ConsentRecord
import com.trippilot.auth.domain.consent.MarketingConsent
import com.trippilot.auth.domain.consent.TermsType
import com.trippilot.auth.domain.consent.TermsVersion
import com.trippilot.auth.domain.port.ConsentRecordRepository
import com.trippilot.auth.domain.port.MarketingConsentRepository
import com.trippilot.auth.domain.port.TermsVersionRepository
import org.springframework.stereotype.Repository
import java.time.Instant

/** TermsVersionRepository 포트의 JPA 구현. 현행 = effective_at ≤ now 중 타입별 최신(INV-T2). */
@Repository
class JpaTermsVersionRepository(
    private val jpa: TermsVersionJpaRepository,
) : TermsVersionRepository {
    override fun findCurrent(termsType: TermsType, at: Instant): TermsVersion? =
        jpa.findFirstByTermsTypeAndEffectiveAtLessThanEqualOrderByEffectiveAtDesc(termsType.name, at)?.toDomain()

    override fun findAllCurrent(at: Instant): List<TermsVersion> =
        jpa.findByEffectiveAtLessThanEqual(at)
            .groupBy { it.termsType }
            .map { (_, versions) -> versions.maxBy { it.effectiveAt } }
            .map { it.toDomain() }
}

/** ConsentRecordRepository 포트의 JPA 구현 — append-only(INV-C1). */
@Repository
class JpaConsentRecordRepository(
    private val jpa: ConsentRecordJpaRepository,
) : ConsentRecordRepository {
    override fun append(record: ConsentRecord) {
        jpa.save(record.toEntity()) // record_id=null → IDENTITY 신규 INSERT
    }

    override fun findByAccount(accountId: AccountId): List<ConsentRecord> =
        jpa.findByAccountIdOrderByOccurredAtDesc(accountId.value).map { it.toDomain() }

    // 행 잠금(`FOR UPDATE`)은 쓸 수 없다 — 앱 롤은 consent_record 에 UPDATE 권한이 없고(INV-C1) 첫 증적 전엔 잠글 행도 없다.
    // UUID 를 int 로 접어 다른 계정과 키가 겹칠 수 있지만 잠깐 줄을 설 뿐 정확성엔 영향이 없다.
    override fun lockAccount(accountId: AccountId) {
        jpa.advisoryXactLock(CONSENT_WRITE_LOCK, accountId.value.hashCode())
    }
}

private const val CONSENT_WRITE_LOCK = 1689

/** MarketingConsentRepository 포트의 JPA 구현(계정당 1행 upsert). */
@Repository
class JpaMarketingConsentRepository(
    private val jpa: MarketingConsentJpaRepository,
) : MarketingConsentRepository {
    override fun find(accountId: AccountId): MarketingConsent? =
        jpa.findById(accountId.value).orElse(null)?.toDomain()

    override fun save(consent: MarketingConsent): MarketingConsent {
        jpa.save(consent.toEntity())
        return consent
    }
}
