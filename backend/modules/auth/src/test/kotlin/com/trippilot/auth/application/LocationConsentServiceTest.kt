package com.trippilot.auth.application

import com.trippilot.auth.domain.AccountId
import com.trippilot.auth.api.event.GpsRecordingOptOut
import com.trippilot.auth.domain.consent.ConsentAction
import com.trippilot.auth.domain.consent.ConsentRecord
import com.trippilot.auth.domain.consent.TermsType
import com.trippilot.auth.domain.consent.TermsVersion
import com.trippilot.auth.domain.location.LocationConsent
import com.trippilot.auth.domain.location.LocationLegalEvent
import com.trippilot.auth.domain.location.LocationLegalEventType
import com.trippilot.auth.domain.location.OsPermission
import com.trippilot.auth.domain.port.ConsentRecordRepository
import com.trippilot.auth.domain.port.LocationConsentStateRepository
import com.trippilot.auth.domain.port.LocationLegalLogRepository
import com.trippilot.auth.domain.port.TermsVersionRepository
import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.collections.shouldBeEmpty
import io.kotest.matchers.collections.shouldContainExactly
import io.kotest.matchers.shouldBe
import java.time.Clock
import java.time.Instant
import java.time.ZoneOffset
import java.util.UUID

private class FakeLocationStateRepo : LocationConsentStateRepository {
    val stored = mutableMapOf<AccountId, LocationConsent>()
    override fun find(accountId: AccountId) = stored[accountId]
    override fun save(state: LocationConsent) = state.also { stored[it.accountId] = it }
}

private class FakeLegalLogRepo : LocationLegalLogRepository {
    val events = mutableListOf<LocationLegalEvent>()
    override fun append(event: LocationLegalEvent) { events.add(event) }
    override fun purgeExpired(): Int = 0 // 보존기간 파기는 DB 함수 소관(V2.49) — 단위 대역에선 지울 것이 없다
}

private class FakeConsentRecords : ConsentRecordRepository {
    val appended = mutableListOf<ConsentRecord>()
    override fun append(record: ConsentRecord) { appended.add(record) }
    override fun findByAccount(accountId: AccountId) = appended.filter { it.accountId == accountId }
}

private class FakeTerms : TermsVersionRepository {
    override fun findCurrent(termsType: TermsType, at: Instant) = TermsVersion(termsType, "1.0", "본문", at.minusSeconds(1), false)
    override fun findAllCurrent(at: Instant) = emptyList<TermsVersion>()
}

class LocationConsentServiceTest : StringSpec({

    val now = Instant.parse("2026-07-19T00:00:00Z")
    val clock = Clock.fixed(now, ZoneOffset.UTC)
    val account = AccountId(UUID.randomUUID())

    /** 발행된 이벤트를 붙든다 — 철회가 **파기 신호를 실제로 내보내는지**는 여기서만 보인다. */
    class Events : com.trippilot.core.event.DomainEventPublisher {
        val published = mutableListOf<com.trippilot.core.event.DomainEvent>()
        override fun publish(event: com.trippilot.core.event.DomainEvent) { published += event }
    }

    fun fixture(): Triple<LocationConsentService, FakeLegalLogRepo, FakeConsentRecords> {
        val log = FakeLegalLogRepo()
        val records = FakeConsentRecords()
        val svc = LocationConsentService(FakeLocationStateRepo(), log, FakeTerms(), records, Events(), clock)
        return Triple(svc, log, records)
    }

    "미설정 계정 get 은 기본값(모든 층 비활성)" {
        val (svc, _, _) = fixture()
        val state = svc.get(account)
        state.osPermission shouldBe OsPermission.NOT_DETERMINED
        state.legalConsent shouldBe false
        state.gpsRecordingOptIn shouldBe false
    }

    "L2 GRANT — consent_record(LOCATION_TERMS GRANT) + legal_log(CONSENT_GRANTED)" {
        val (svc, log, records) = fixture()

        val state = svc.update(account, legalConsent = true, gpsRecordingOptIn = null)

        state.legalConsent shouldBe true
        records.appended.single().let {
            it.termsType shouldBe TermsType.LOCATION_TERMS
            it.action shouldBe ConsentAction.GRANT
        }
        log.events.map { it.eventType } shouldContainExactly listOf(LocationLegalEventType.CONSENT_GRANTED)
    }

    "L3 철회 — GPS_RECORDING REVOKE 증적 + CONSENT_REVOKED + PURGE(INV-L4)" {
        val (svc, log, records) = fixture()
        svc.update(account, legalConsent = true, gpsRecordingOptIn = true) // 선행 활성
        log.events.clear(); records.appended.clear()

        svc.update(account, legalConsent = null, gpsRecordingOptIn = false) // L3 철회

        records.appended.single().action shouldBe ConsentAction.REVOKE
        log.events.map { it.eventType } shouldContainExactly
            listOf(LocationLegalEventType.CONSENT_REVOKED, LocationLegalEventType.PURGE)
    }

    "값이 안 바뀌면 증적·로그 없음(멱등)" {
        val (svc, log, records) = fixture()
        svc.update(account, legalConsent = true, gpsRecordingOptIn = null)
        log.events.clear(); records.appended.clear()

        svc.update(account, legalConsent = true, gpsRecordingOptIn = null) // 동일 값

        records.appended.shouldBeEmpty()
        log.events.shouldBeEmpty()
    }

    "L1 미러는 순수 반영 — 증적·로그 없음, L2·L3 보존(INV-L3)" {
        val (svc, log, records) = fixture()
        svc.update(account, legalConsent = true, gpsRecordingOptIn = true)
        log.events.clear(); records.appended.clear()

        svc.mirrorOsPermission(account, OsPermission.DENIED)

        val state = svc.get(account)
        state.osPermission shouldBe OsPermission.DENIED
        state.legalConsent shouldBe true       // 보존
        state.gpsRecordingOptIn shouldBe true  // 보존
        records.appended.shouldBeEmpty()
        log.events.shouldBeEmpty()
    }

    "L1 GRANTED + L2 + L3 이후 유효 능력 전부 활성" {
        val (svc, _, _) = fixture()
        svc.update(account, legalConsent = true, gpsRecordingOptIn = true)
        svc.mirrorOsPermission(account, OsPermission.GRANTED)

        val caps = svc.get(account).capabilities()
        caps.serverLocationService shouldBe true
        caps.gpsTrackRetention shouldBe true
    }
    /**
     * 철회는 **파기 신호까지 내보내야** 완결된다(INV-L4). 저장된 위치정보는 저마다 다른 모듈이
     * 갖고 있어 auth 가 직접 못 지운다 — 신호가 빠지면 아무도 안 지우고, 로그만 "파기했다"고 말한다.
     */
    "L3 를 철회하면 파기 신호를 발행한다" {
        val events = Events()
        val svc = LocationConsentService(FakeLocationStateRepo(), FakeLegalLogRepo(), FakeTerms(), FakeConsentRecords(), events, clock)
        svc.update(account, legalConsent = true, gpsRecordingOptIn = true)
        events.published.clear()

        svc.update(account, legalConsent = true, gpsRecordingOptIn = false)

        val signal = events.published.filterIsInstance<GpsRecordingOptOut>().single()
        signal.aggregateId shouldBe account.value.toString()
        signal.reason shouldBe GpsRecordingOptOut.REASON_REVOKED
    }

    /** 켜는 것은 파기가 아니다 — 신호를 남발하면 구독자가 매번 전량을 훑는다. */
    "동의를 켤 때는 파기 신호가 없다" {
        val events = Events()
        val svc = LocationConsentService(FakeLocationStateRepo(), FakeLegalLogRepo(), FakeTerms(), FakeConsentRecords(), events, clock)

        svc.update(account, legalConsent = true, gpsRecordingOptIn = true)

        events.published.filterIsInstance<GpsRecordingOptOut>().shouldBeEmpty()
    }
})
