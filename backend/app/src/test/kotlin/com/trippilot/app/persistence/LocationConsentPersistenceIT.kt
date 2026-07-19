package com.trippilot.app.persistence

import com.trippilot.auth.adapter.out.persistence.LocationLegalLogJpaRepository
import com.trippilot.auth.domain.Account
import com.trippilot.auth.domain.AgeMethod
import com.trippilot.auth.domain.location.LocationConsent
import com.trippilot.auth.domain.location.LocationLegalEvent
import com.trippilot.auth.domain.location.LocationLegalEventType
import com.trippilot.auth.domain.location.OsPermission
import com.trippilot.auth.domain.port.AccountRepository
import com.trippilot.auth.domain.port.LocationConsentStateRepository
import com.trippilot.auth.domain.port.LocationLegalLogRepository
import com.trippilot.testsupport.AbstractPostgresIntegrationTest
import io.kotest.matchers.nulls.shouldNotBeNull
import io.kotest.matchers.shouldBe
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.context.SpringBootTest
import java.time.Instant

/**
 * TRIP-155 — 위치 동의 영속 IT. location_consent_state upsert + location_legal_log append(jsonb detail).
 */
@SpringBootTest
class LocationConsentPersistenceIT : AbstractPostgresIntegrationTest() {

    @Autowired lateinit var accounts: AccountRepository
    @Autowired lateinit var states: LocationConsentStateRepository
    @Autowired lateinit var legalLog: LocationLegalLogRepository
    @Autowired lateinit var legalLogJpa: LocationLegalLogJpaRepository

    private val now = Instant.parse("2026-07-19T00:00:00Z")

    private fun newAccount() = accounts.save(Account.registerViaSocial(null, AgeMethod.SELF_DECLARED, null, now))

    @Test
    fun `3층 상태 upsert — 저장·갱신·조회`() {
        val account = newAccount()
        states.save(LocationConsent.reconstitute(account.id, OsPermission.GRANTED, legalConsent = true, gpsRecordingOptIn = false, now))

        states.find(account.id).shouldNotBeNull().let {
            it.osPermission shouldBe OsPermission.GRANTED
            it.legalConsent shouldBe true
            it.gpsRecordingOptIn shouldBe false
        }

        // 같은 계정 갱신(upsert)
        states.save(LocationConsent.reconstitute(account.id, OsPermission.DENIED, legalConsent = true, gpsRecordingOptIn = true, now.plusSeconds(1)))
        states.find(account.id).shouldNotBeNull().gpsRecordingOptIn shouldBe true
    }

    @Test
    fun `법정 로그 append — jsonb detail 이 객체로 저장·왕복(이중인코딩 아님, INV-LL1)`() {
        val account = newAccount()
        val before = legalLogJpa.count()

        legalLog.append(
            LocationLegalEvent.of(
                account.id, LocationLegalEventType.CONSENT_GRANTED,
                mapOf("termsType" to "LOCATION_TERMS", "version" to "1.0", "channel" to "SETTINGS"), now,
            ),
        )

        legalLogJpa.count() shouldBe before + 1
        // detail 을 Map 으로 되읽어 키가 살아있으면 jsonb 객체로 저장된 것(이스케이프 스칼라면 역직렬화 실패/불일치)
        val saved = legalLogJpa.findAll().first { it.accountId == account.id.value }
        saved.detail["termsType"] shouldBe "LOCATION_TERMS"
        saved.detail["channel"] shouldBe "SETTINGS"
    }
}
