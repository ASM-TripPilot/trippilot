package com.trippilot.app

import com.trippilot.auth.domain.Account
import com.trippilot.auth.domain.AgeMethod
import com.trippilot.auth.domain.consent.ConsentAction
import com.trippilot.auth.domain.consent.ConsentChannel
import com.trippilot.auth.domain.consent.ConsentRecord
import com.trippilot.auth.domain.consent.TermsType
import com.trippilot.auth.domain.AccountId
import com.trippilot.auth.domain.port.AccountRepository
import com.trippilot.auth.domain.port.ConsentRecordRepository
import com.trippilot.itinerarygeneration.domain.PersonalizationPort
import com.trippilot.reflection.api.PersonalizationReason
import com.trippilot.reflection.application.PersonalizationService
import com.trippilot.reflection.domain.CategoryShare
import com.trippilot.reflection.domain.StyleAnalysis
import com.trippilot.reflection.domain.StyleAnalysisRepository
import com.trippilot.reflection.domain.TraitGauges
import com.trippilot.testsupport.AbstractPostgresIntegrationTest
import io.kotest.matchers.collections.shouldBeEmpty
import io.kotest.matchers.collections.shouldContainExactly
import io.kotest.matchers.shouldBe
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.context.SpringBootTest
import java.time.Instant
import java.util.UUID

/**
 * 개인화 동의 게이트 실 DB 검증(TRIP-556 · BR-U5-44).
 *
 * 여기서만 드러나는 것 — 인메모리 대역으로는 **원리적으로** 못 본다:
 * - **동의 로그가 append-only 라는 사실** — GRANT 뒤에 REVOKE 가 쌓인다. 판정이 "존재 여부"면
 *   철회한 사용자를 동의한 것으로 읽는데, Map 대역은 덮어써서 그 상황 자체가 만들어지지 않는다
 * - **배선이 실제로 이어지는가** — 일정 생성의 포트가 개인화(U5)에 닿는지는 조립(app)의 문제라
 *   단위 테스트로는 확인할 수 없다. 어댑터가 없으면 컨텍스트도 안 뜬다
 */
@SpringBootTest
class PersonalizationGateIT : AbstractPostgresIntegrationTest() {

    @Autowired private lateinit var personalization: PersonalizationService
    @Autowired private lateinit var port: PersonalizationPort
    @Autowired private lateinit var analyses: StyleAnalysisRepository
    @Autowired private lateinit var consents: ConsentRecordRepository
    @Autowired private lateinit var accounts: AccountRepository

    private val now = Instant.parse("2026-08-11T01:00:00Z")

    private fun newAccount(): AccountId =
        accounts.save(Account.registerViaSocial(null, AgeMethod.SELF_DECLARED, null, now)).id

    private fun record(id: AccountId, action: ConsentAction, at: Instant) {
        consents.append(
            ConsentRecord.of(id, TermsType.PERSONALIZATION, "1.0", action, ConsentChannel.SETTINGS, at),
        )
    }

    private fun seedAnalysis(accountId: UUID) {
        analyses.upsert(
            StyleAnalysis(
                accountId = accountId,
                descriptors = listOf("#카페"),
                traitGauges = TraitGauges(easygoing = 5, foodAffinity = 3, activeness = 1),
                categoryBreakdown = listOf(CategoryShare("카페", 0.6), CategoryShare("맛집", 0.4)),
                avgPlacesPerDay = 2.0,
                avgRadiusKm = 1.2,
                avgDwellMinutes = 72,
                sampleTripCount = 2,
                sampleVisitCount = 11,
                updatedAt = now,
            ),
        )
    }

    @Test
    fun `동의한 적 없으면 과거 기록이 추천 입력에 들어가지 않는다`() {
        val id = newAccount()
        seedAnalysis(id.value)

        val view = personalization.deriveFor(id.value)

        view.applied shouldBe false
        view.reason shouldBe PersonalizationReason.CONSENT_MISSING
        // 포트를 통해 일정 생성이 받는 값도 비어 있어야 한다 — 배선 어느 지점에서 새도 여기서 잡힌다.
        port.hintsFor(id.value).activities.shouldBeEmpty()
        port.hintsFor(id.value).pace shouldBe null
    }

    @Test
    fun `동의하면 들어간다 — 게이트가 실제로 여닫힌다`() {
        val id = newAccount()
        seedAnalysis(id.value)
        record(id, ConsentAction.GRANT, now)

        val view = personalization.deriveFor(id.value)

        view.applied shouldBe true
        view.reason shouldBe PersonalizationReason.APPLIED
        port.hintsFor(id.value).activities shouldContainExactly listOf("카페", "맛집투어")
        port.hintsFor(id.value).pace shouldBe "느긋하게"
    }

    @Test
    fun `철회하면 다시 빠진다 — 동의 로그는 덮어쓰지 않고 쌓인다`() {
        val id = newAccount()
        seedAnalysis(id.value)
        record(id, ConsentAction.GRANT, now)
        record(id, ConsentAction.REVOKE, now.plusSeconds(60))

        val view = personalization.deriveFor(id.value)

        // 존재 여부로 판정했다면 여기서 여전히 true 다 — GRANT 행이 남아 있기 때문이다.
        view.applied shouldBe false
        view.reason shouldBe PersonalizationReason.CONSENT_MISSING
        port.hintsFor(id.value).activities.shouldBeEmpty()
    }

    @Test
    fun `동의는 있는데 분석이 없으면 사유가 다르다`() {
        val id = newAccount()
        record(id, ConsentAction.GRANT, now)

        val view = personalization.deriveFor(id.value)

        view.applied shouldBe false
        view.reason shouldBe PersonalizationReason.NOT_ENOUGH_RECORDS
        view.sharedItems.shouldBeEmpty()
    }
}
