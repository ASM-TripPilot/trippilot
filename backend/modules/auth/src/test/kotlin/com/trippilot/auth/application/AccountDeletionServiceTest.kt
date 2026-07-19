package com.trippilot.auth.application

import com.trippilot.auth.domain.Account
import com.trippilot.auth.domain.AccountId
import com.trippilot.auth.domain.AccountStatus
import com.trippilot.auth.domain.AgeMethod
import com.trippilot.auth.domain.DeletionSchedule
import com.trippilot.auth.domain.RefreshSession
import com.trippilot.auth.domain.consent.ConsentRecord
import com.trippilot.auth.domain.location.LocationConsent
import com.trippilot.auth.domain.location.LocationLegalEvent
import com.trippilot.auth.domain.location.LocationLegalEventType
import com.trippilot.auth.domain.port.AccountRepository
import com.trippilot.auth.domain.port.ConsentRecordRepository
import com.trippilot.auth.domain.port.DeletionScheduleRepository
import com.trippilot.auth.domain.port.LocationConsentStateRepository
import com.trippilot.auth.domain.port.LocationLegalLogRepository
import com.trippilot.auth.domain.port.RefreshSessionRepository
import com.trippilot.auth.domain.port.TermsVersionRepository
import com.trippilot.core.error.ConflictDetected
import com.trippilot.core.error.ResourceNotFound
import com.trippilot.core.event.DomainEvent
import com.trippilot.core.event.DomainEventPublisher
import io.kotest.assertions.throwables.shouldThrow
import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.nulls.shouldNotBeNull
import io.kotest.matchers.shouldBe
import java.time.Clock
import java.time.Instant
import java.time.ZoneOffset
import java.util.UUID

private class FakeAccounts : AccountRepository {
    val stored = mutableMapOf<AccountId, Account>()
    override fun findById(id: AccountId) = stored[id]
    override fun save(account: Account) = account.also { stored[it.id] = it }
}

private class FakeSchedules : DeletionScheduleRepository {
    val saved = mutableMapOf<UUID, DeletionSchedule>() // deletionId 로 upsert(실제 PK 의미)
    override fun findActive(accountId: AccountId) = saved.values.lastOrNull { it.accountId == accountId && it.active }
    override fun save(schedule: DeletionSchedule) = schedule.also { saved[it.deletionId] = it }
}

private class FakeSessions : RefreshSessionRepository {
    var revokedAccount: AccountId? = null
    override fun save(session: RefreshSession) = session
    override fun findByTokenHash(tokenHash: String): RefreshSession? = null
    override fun revokeChain(chainId: UUID, now: Instant) = 0
    override fun revokeByAccount(accountId: AccountId, now: Instant): Int {
        revokedAccount = accountId; return 1
    }
}

private class FakeLegalLog : LocationLegalLogRepository {
    val events = mutableListOf<LocationLegalEvent>()
    override fun append(event: LocationLegalEvent) { events.add(event) }
}

private class FakeStateRepo : LocationConsentStateRepository {
    override fun find(accountId: AccountId): LocationConsent? = null
    override fun save(state: LocationConsent) = state
}

private class EmptyTerms : TermsVersionRepository {
    override fun findCurrent(termsType: com.trippilot.auth.domain.consent.TermsType, at: Instant) = null
    override fun findAllCurrent(at: Instant) = emptyList<com.trippilot.auth.domain.consent.TermsVersion>()
}

private class NoopConsentRecords : ConsentRecordRepository {
    override fun append(record: ConsentRecord) {}
    override fun findByAccount(accountId: AccountId) = emptyList<ConsentRecord>()
}

private class CapturingPublisher : DomainEventPublisher {
    val events = mutableListOf<DomainEvent>()
    override fun publish(event: DomainEvent) { events.add(event) }
}

class AccountDeletionServiceTest : StringSpec({

    val now = Instant.parse("2026-07-19T00:00:00Z")
    val clock = Clock.fixed(now, ZoneOffset.UTC)

    fun fixture(): Triple<AccountDeletionService, FakeAccounts, Triple<FakeSchedules, FakeSessions, CapturingPublisher>> {
        val accounts = FakeAccounts()
        val schedules = FakeSchedules()
        val sessions = FakeSessions()
        val legalLog = FakeLegalLog()
        val publisher = CapturingPublisher()
        val location = LocationConsentService(FakeStateRepo(), legalLog, EmptyTerms(), NoopConsentRecords(), clock)
        val svc = AccountDeletionService(accounts, schedules, sessions, location, publisher, clock)
        return Triple(svc, accounts, Triple(schedules, sessions, publisher))
    }

    fun activeAccount(accounts: FakeAccounts): AccountId {
        val account = accounts.save(Account.registerViaSocial("u@e.com", AgeMethod.SELF_DECLARED, null, now))
        return account.id
    }

    "삭제 요청 — DELETION_PENDING + 유예 예약 + 세션 폐기 + 이벤트" {
        val (svc, accounts, rest) = fixture()
        val (schedules, sessions, publisher) = rest
        val id = activeAccount(accounts)

        val result = svc.requestDeletion(id)

        accounts.findById(id)!!.status shouldBe AccountStatus.DELETION_PENDING
        result.purgeAt shouldBe now.plus(AccountDeletionService.GRACE_PERIOD)
        result.cascadeSummary.legallyRetained shouldBe listOf("CONSENT_RECORD", "LOCATION_LEGAL_LOG")
        schedules.findActive(id).shouldNotBeNull()
        sessions.revokedAccount shouldBe id // 전 기기 세션 폐기
        publisher.events.map { it.eventType } shouldBe listOf("auth.AccountDeletionRequested")
    }

    "삭제 요청 시 GPS 파기(PURGE) 로그가 남는다" {
        val accounts = FakeAccounts()
        val legalLog = FakeLegalLog()
        val location = LocationConsentService(FakeStateRepo(), legalLog, EmptyTerms(), NoopConsentRecords(), clock)
        val svc = AccountDeletionService(accounts, FakeSchedules(), FakeSessions(), location, CapturingPublisher(), clock)
        val id = activeAccount(accounts)

        svc.requestDeletion(id)

        legalLog.events.single().eventType shouldBe LocationLegalEventType.PURGE
    }

    "이미 삭제 진행 중이면 409" {
        val (svc, accounts, _) = fixture()
        val id = activeAccount(accounts)
        svc.requestDeletion(id)

        shouldThrow<ConflictDetected> { svc.requestDeletion(id) }
    }

    "철회 — DELETION_PENDING → ACTIVE + 예약 취소 + 이벤트" {
        val (svc, accounts, rest) = fixture()
        val (schedules, _, publisher) = rest
        val id = activeAccount(accounts)
        svc.requestDeletion(id)
        publisher.events.clear()

        svc.cancelDeletion(id)

        accounts.findById(id)!!.status shouldBe AccountStatus.ACTIVE
        schedules.findActive(id) shouldBe null // 더 이상 활성 예약 없음
        publisher.events.map { it.eventType } shouldBe listOf("auth.AccountDeletionCancelled")
    }

    "활성 예약이 없으면 철회는 404" {
        val (svc, accounts, _) = fixture()
        val id = activeAccount(accounts)
        shouldThrow<ResourceNotFound> { svc.cancelDeletion(id) }
    }
})
