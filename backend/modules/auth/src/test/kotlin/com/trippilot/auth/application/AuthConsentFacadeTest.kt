package com.trippilot.auth.application

import com.trippilot.auth.domain.AccountId
import com.trippilot.auth.domain.consent.ConsentAction
import com.trippilot.auth.domain.consent.ConsentChannel
import com.trippilot.auth.domain.consent.ConsentRecord
import com.trippilot.auth.domain.consent.MarketingConsent
import com.trippilot.auth.domain.consent.TermsType
import com.trippilot.auth.domain.consent.TermsVersion
import com.trippilot.auth.domain.port.ConsentRecordRepository
import com.trippilot.auth.domain.port.MarketingConsentRepository
import com.trippilot.auth.domain.port.TermsVersionRepository
import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.shouldBe
import java.time.Clock
import java.time.Instant
import java.time.ZoneOffset
import java.util.UUID

private class FacadeTerms(private val all: List<TermsVersion>) : TermsVersionRepository {
    override fun findCurrent(termsType: TermsType, at: Instant) =
        all.filter { it.termsType == termsType && !it.effectiveAt.isAfter(at) }.maxByOrNull { it.effectiveAt }
    override fun findAllCurrent(at: Instant) =
        all.filter { !it.effectiveAt.isAfter(at) }.groupBy { it.termsType }.map { (_, v) -> v.maxBy { it.effectiveAt } }
}

private class FacadeRecords : ConsentRecordRepository {
    val appended = mutableListOf<ConsentRecord>()
    override fun append(record: ConsentRecord) { appended.add(record) }
    override fun findByAccount(accountId: AccountId) = appended.filter { it.accountId == accountId }
}

private class FacadeMarketing : MarketingConsentRepository {
    override fun find(accountId: AccountId): MarketingConsent? = null
    override fun save(consent: MarketingConsent) = consent
}

/** 온보딩 게이트가 부트스트랩 재동의 로직과 정합함을 검증(구버전 GRANT 로 통과 방지). */
class AuthConsentFacadeTest : StringSpec({

    val now = Instant.parse("2026-07-19T00:00:00Z")
    val past = now.minusSeconds(86_400)
    val clock = Clock.fixed(now, ZoneOffset.UTC)
    val account = AccountId(UUID.randomUUID())

    fun facade(terms: List<TermsVersion>, records: FacadeRecords) =
        AuthConsentFacade(ConsentService(FacadeTerms(terms), records, FacadeMarketing(), clock))

    "필수 약관 현행 버전 동의면 true" {
        val records = FacadeRecords()
        listOf(TermsType.TERMS_OF_SERVICE, TermsType.PRIVACY_POLICY).forEach {
            records.append(ConsentRecord.of(account, it, "1.0", ConsentAction.GRANT, ConsentChannel.ONBOARDING, now))
        }
        val terms = listOf(
            TermsVersion(TermsType.TERMS_OF_SERVICE, "1.0", "b", past, false),
            TermsVersion(TermsType.PRIVACY_POLICY, "1.0", "b", past, false),
        )
        facade(terms, records).hasCompletedOnboardingConsents(account.value) shouldBe true
    }

    "필수 약관이 구버전 GRANT + 현행 reconsent 필요면 false(정합)" {
        val records = FacadeRecords()
        records.append(ConsentRecord.of(account, TermsType.TERMS_OF_SERVICE, "1.0", ConsentAction.GRANT, ConsentChannel.ONBOARDING, now))
        records.append(ConsentRecord.of(account, TermsType.PRIVACY_POLICY, "1.0", ConsentAction.GRANT, ConsentChannel.ONBOARDING, now)) // 구버전
        val terms = listOf(
            TermsVersion(TermsType.TERMS_OF_SERVICE, "1.0", "b", past, false),
            TermsVersion(TermsType.PRIVACY_POLICY, "2.0", "b", past, reconsentRequired = true), // 현행 v2.0 재동의 필요
        )
        val f = facade(terms, records)
        f.hasCompletedOnboardingConsents(account.value) shouldBe false
        f.requiredReconsentTermsTypes(account.value) shouldBe listOf("PRIVACY_POLICY")

        // 현행 버전 재동의하면 true
        records.append(ConsentRecord.of(account, TermsType.PRIVACY_POLICY, "2.0", ConsentAction.GRANT, ConsentChannel.RECONSENT, now.plusSeconds(1)))
        f.hasCompletedOnboardingConsents(account.value) shouldBe true
    }

    "필수 약관 미동의면 false" {
        facade(emptyList(), FacadeRecords()).hasCompletedOnboardingConsents(account.value) shouldBe false
    }
})
