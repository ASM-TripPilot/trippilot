package com.trippilot.auth.domain.port

import com.trippilot.auth.domain.AccountId
import com.trippilot.auth.domain.consent.ConsentRecord
import com.trippilot.auth.domain.consent.MarketingConsent
import com.trippilot.auth.domain.consent.TermsType
import com.trippilot.auth.domain.consent.TermsVersion
import java.time.Instant

/** 약관 버전 조회 포트(읽기 전용). 현행 = effective_at ≤ now 중 최신(INV-T2). */
interface TermsVersionRepository {
    fun findCurrent(termsType: TermsType, at: Instant): TermsVersion?

    fun findAllCurrent(at: Instant): List<TermsVersion>
}

/** 동의 증적 포트 — **추가 전용**(INV-C1). 조회는 폴드용 전체 로드. */
interface ConsentRecordRepository {
    fun append(record: ConsentRecord)

    fun findByAccount(accountId: AccountId): List<ConsentRecord>

    /**
     * 계정 단위로 증적 쓰기를 줄 세운다(TRIP-1689) — 호출측 트랜잭션 끝까지 유지. "최신과 다를 때만 추가"의
     * 읽기 전에 걸어야 두 기기 동시 요청이 둘 다 "다르다"고 보고 두 줄을 남기지 않는다.
     */
    fun lockAccount(accountId: AccountId)
}

/** 마케팅 동의 현재값 포트(계정당 1행 upsert). */
interface MarketingConsentRepository {
    fun find(accountId: AccountId): MarketingConsent?

    fun save(consent: MarketingConsent): MarketingConsent
}
