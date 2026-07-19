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
import com.trippilot.core.error.ResourceNotFound
import com.trippilot.core.error.ValidationFailed
import io.kotest.assertions.throwables.shouldThrow
import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.collections.shouldContainExactlyInAnyOrder
import io.kotest.matchers.collections.shouldHaveSize
import io.kotest.matchers.shouldBe
import java.time.Clock
import java.time.Instant
import java.time.ZoneOffset
import java.util.UUID

private class FakeTermsVersionRepository(private val all: MutableList<TermsVersion>) : TermsVersionRepository {
    override fun findCurrent(termsType: TermsType, at: Instant): TermsVersion? =
        all.filter { it.termsType == termsType && !it.effectiveAt.isAfter(at) }.maxByOrNull { it.effectiveAt }

    override fun findAllCurrent(at: Instant): List<TermsVersion> =
        all.filter { !it.effectiveAt.isAfter(at) }.groupBy { it.termsType }.map { (_, v) -> v.maxBy { it.effectiveAt } }
}

private class FakeConsentRecordRepository : ConsentRecordRepository {
    val appended = mutableListOf<ConsentRecord>()
    override fun append(record: ConsentRecord) { appended.add(record) }
    override fun findByAccount(accountId: AccountId): List<ConsentRecord> = appended.filter { it.accountId == accountId }
}

private class FakeMarketingConsentRepository : MarketingConsentRepository {
    val stored = mutableMapOf<AccountId, MarketingConsent>()
    override fun find(accountId: AccountId): MarketingConsent? = stored[accountId]
    override fun save(consent: MarketingConsent): MarketingConsent = consent.also { stored[it.accountId] = it }
}

class ConsentServiceTest : StringSpec({

    val now = Instant.parse("2026-07-19T00:00:00Z")
    val clock = Clock.fixed(now, ZoneOffset.UTC)
    val account = AccountId(UUID.randomUUID())
    val past = now.minusSeconds(86_400)

    fun term(type: TermsType, version: String = "1.0", reconsent: Boolean = false) =
        TermsVersion(type, version, "본문", past, reconsent)

    fun fixture(terms: List<TermsVersion>): Triple<ConsentService, FakeConsentRecordRepository, FakeMarketingConsentRepository> {
        val records = FakeConsentRecordRepository()
        val marketing = FakeMarketingConsentRepository()
        val svc = ConsentService(FakeTermsVersionRepository(terms.toMutableList()), records, marketing, clock)
        return Triple(svc, records, marketing)
    }

    val baseTerms = listOf(
        term(TermsType.TERMS_OF_SERVICE),
        term(TermsType.PRIVACY_POLICY),
        term(TermsType.MARKETING),
    )

    "온보딩 일괄 동의 — 필수 2종 GRANT 시 채널 ONBOARDING 으로 증적 추가" {
        val (svc, records, _) = fixture(baseTerms)

        svc.submitOnboarding(
            account,
            listOf(
                ConsentSubmission(TermsType.TERMS_OF_SERVICE, "1.0", ConsentAction.GRANT),
                ConsentSubmission(TermsType.PRIVACY_POLICY, "1.0", ConsentAction.GRANT),
                ConsentSubmission(TermsType.MARKETING, "1.0", ConsentAction.REVOKE),
            ),
        )

        records.appended shouldHaveSize 3
        records.appended.all { it.channel == ConsentChannel.ONBOARDING } shouldBe true
    }

    "온보딩 — 필수 약관(개인정보) GRANT 누락 시 ValidationFailed" {
        val (svc, _, _) = fixture(baseTerms)
        shouldThrow<ValidationFailed> {
            svc.submitOnboarding(account, listOf(ConsentSubmission(TermsType.TERMS_OF_SERVICE, "1.0", ConsentAction.GRANT)))
        }
    }

    "온보딩 — 구버전 제출 시 ValidationFailed(현행 아님)" {
        val (svc, _, _) = fixture(baseTerms)
        shouldThrow<ValidationFailed> {
            svc.submitOnboarding(
                account,
                listOf(
                    ConsentSubmission(TermsType.TERMS_OF_SERVICE, "0.9", ConsentAction.GRANT),
                    ConsentSubmission(TermsType.PRIVACY_POLICY, "1.0", ConsentAction.GRANT),
                ),
            )
        }
    }

    "status — 타입별 최신 상태를 폴드한다" {
        val (svc, _, _) = fixture(baseTerms)
        svc.submitOnboarding(
            account,
            listOf(
                ConsentSubmission(TermsType.TERMS_OF_SERVICE, "1.0", ConsentAction.GRANT),
                ConsentSubmission(TermsType.PRIVACY_POLICY, "1.0", ConsentAction.GRANT),
            ),
        )
        svc.status(account).map { it.termsType } shouldContainExactlyInAnyOrder
            listOf(TermsType.TERMS_OF_SERVICE, TermsType.PRIVACY_POLICY)
    }

    "changeConsent — reconsent_required 신버전 GRANT 는 채널 RECONSENT 로 추론" {
        val (svc, records, _) = fixture(listOf(term(TermsType.PRIVACY_POLICY, "2.0", reconsent = true)))

        svc.changeConsent(account, TermsType.PRIVACY_POLICY, ConsentAction.GRANT, "2.0")

        records.appended.single().channel shouldBe ConsentChannel.RECONSENT
    }

    "changeConsent — 일반 REVOKE 는 채널 SETTINGS" {
        val (svc, records, _) = fixture(baseTerms)
        svc.changeConsent(account, TermsType.MARKETING, ConsentAction.REVOKE, "1.0")
        records.appended.single().channel shouldBe ConsentChannel.SETTINGS
    }

    "toggleMarketing — opt_in 갱신과 증적 추가가 함께 일어난다(INV-M1)" {
        val (svc, records, marketing) = fixture(baseTerms)

        svc.toggleMarketing(account, optIn = true)

        marketing.find(account)!!.optIn shouldBe true
        val rec = records.appended.single()
        rec.termsType shouldBe TermsType.MARKETING
        rec.action shouldBe ConsentAction.GRANT
    }

    "requiredReconsents — reconsent_required 이고 미동의(구버전)인 약관을 반환" {
        val (svc, _, _) = fixture(
            listOf(
                term(TermsType.TERMS_OF_SERVICE, "1.0", reconsent = false),
                term(TermsType.PRIVACY_POLICY, "2.0", reconsent = true),
            ),
        )
        // 이용약관만 동의(현행), 개인정보 재동의 필요
        svc.changeConsent(account, TermsType.TERMS_OF_SERVICE, ConsentAction.GRANT, "1.0")

        svc.requiredReconsents(account) shouldBe listOf(TermsType.PRIVACY_POLICY)

        // 재동의 완료 후에는 비게 된다
        svc.changeConsent(account, TermsType.PRIVACY_POLICY, ConsentAction.GRANT, "2.0")
        svc.requiredReconsents(account) shouldBe emptyList()
    }

    "존재하지 않는 약관 변경은 ResourceNotFound" {
        val (svc, _, _) = fixture(emptyList())
        shouldThrow<ResourceNotFound> {
            svc.changeConsent(account, TermsType.GPS_RECORDING, ConsentAction.GRANT, "1.0")
        }
    }
})
