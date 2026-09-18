package com.trippilot.app.persistence

import com.trippilot.auth.domain.Account
import com.trippilot.auth.domain.AgeMethod
import com.trippilot.auth.domain.consent.ConsentAction
import com.trippilot.auth.domain.consent.ConsentChannel
import com.trippilot.auth.domain.consent.ConsentRecord
import com.trippilot.auth.domain.consent.MarketingConsent
import com.trippilot.auth.domain.consent.TermsType
import com.trippilot.auth.domain.port.AccountRepository
import com.trippilot.auth.domain.port.ConsentRecordRepository
import com.trippilot.auth.domain.port.MarketingConsentRepository
import com.trippilot.auth.domain.port.TermsVersionRepository
import com.trippilot.testsupport.AbstractPostgresIntegrationTest
import io.kotest.matchers.collections.shouldHaveSize
import io.kotest.matchers.nulls.shouldNotBeNull
import io.kotest.matchers.shouldBe
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.context.SpringBootTest
import java.time.Instant

/**
 * TRIP-154 — consent 영속 어댑터 IT. 시드된 terms_version(R__) 위에서 증적 append·폴드·마케팅 upsert 검증.
 */
@SpringBootTest
class ConsentPersistenceIT : AbstractPostgresIntegrationTest() {

    @Autowired lateinit var accounts: AccountRepository
    @Autowired lateinit var terms: TermsVersionRepository
    @Autowired lateinit var consents: ConsentRecordRepository
    @Autowired lateinit var marketing: MarketingConsentRepository

    private val now = Instant.parse("2026-07-19T00:00:00Z")

    private fun newAccount() = accounts.save(Account.registerViaSocial(null, AgeMethod.SELF_DECLARED, null, now))

    @Test
    fun `현행 약관 조회 — 시드 6종, 타입별 최신`() {
        terms.findAllCurrent(now).map { it.termsType }.toSet() shouldBe TermsType.entries.toSet()
        terms.findCurrent(TermsType.TERMS_OF_SERVICE, now).shouldNotBeNull().version shouldBe "1.0"
    }

    @Test
    fun `동의 증적 append 후 계정별 최신순 조회(INV-C1·C2)`() {
        val account = newAccount()
        consents.append(ConsentRecord.of(account.id, TermsType.TERMS_OF_SERVICE, "1.0", ConsentAction.GRANT, ConsentChannel.ONBOARDING, now))
        consents.append(ConsentRecord.of(account.id, TermsType.PRIVACY_POLICY, "1.0", ConsentAction.GRANT, ConsentChannel.ONBOARDING, now.plusSeconds(1)))

        val found = consents.findByAccount(account.id)

        found shouldHaveSize 2
        found.first().termsType shouldBe TermsType.PRIVACY_POLICY // occurredAt 최신순
    }

    @Test
    fun `마케팅 동의 upsert — 계정당 1행`() {
        val account = newAccount()
        marketing.save(MarketingConsent.of(account.id, optIn = true, updatedAt = now))
        marketing.find(account.id).shouldNotBeNull().optIn shouldBe true

        marketing.save(MarketingConsent.of(account.id, optIn = false, updatedAt = now.plusSeconds(1)))
        marketing.find(account.id).shouldNotBeNull().optIn shouldBe false
    }
}
