package com.trippilot.auth.application

import com.trippilot.auth.api.event.AccountDeletionCancelled
import com.trippilot.auth.api.event.AccountDeletionRequested
import com.trippilot.auth.domain.AccountId
import com.trippilot.auth.domain.CascadeSummary
import com.trippilot.auth.domain.DeletionSchedule
import com.trippilot.auth.domain.port.AccountRepository
import com.trippilot.auth.domain.port.DeletionScheduleRepository
import com.trippilot.auth.domain.port.RefreshSessionRepository
import com.trippilot.core.error.AuthenticationRequired
import com.trippilot.core.error.ConflictDetected
import com.trippilot.core.error.ResourceNotFound
import com.trippilot.core.event.DomainEventPublisher
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import java.time.Clock
import java.time.Duration
import java.time.Instant

/** 삭제 요청 결과 — 파기 예정 시각 + 연쇄 범위 고지. */
data class DeletionRequestResult(val purgeAt: Instant, val cascadeSummary: CascadeSummary)

/**
 * 계정 삭제 라이프사이클(TRIP-158). 요청 → DELETION_PENDING + 30일 유예 예약 + **즉시** 부수효과
 * (전 기기 세션 폐기 · GPS 발자취 파기), 철회 → ACTIVE 복원(GPS 미복원, INV-D2).
 * 실제 30일 파기 배치는 후속(스케줄러) — 여기선 예약·이벤트까지.
 */
@Service
class AccountDeletionService(
    private val accounts: AccountRepository,
    private val deletionSchedules: DeletionScheduleRepository,
    private val refreshSessions: RefreshSessionRepository,
    private val locationConsent: LocationConsentService,
    private val eventPublisher: DomainEventPublisher,
    private val clock: Clock,
) {
    @Transactional
    fun requestDeletion(accountId: AccountId): DeletionRequestResult {
        val account = accounts.findById(accountId) ?: throw AuthenticationRequired()
        // INV-D1: 계정당 활성 유예 1개. (Account.requestDeletion 도 ACTIVE 아니면 409 — 이중 방어)
        if (deletionSchedules.findActive(accountId) != null) {
            throw ConflictDetected(current = account.status, message = "이미 삭제가 진행 중입니다.")
        }
        accounts.save(account.requestDeletion()) // ACTIVE → DELETION_PENDING (아니면 ConflictDetected 409)

        val now = clock.instant()
        val purgeAt = now.plus(GRACE_PERIOD)
        val summary = CascadeSummary.forAccount()
        val schedule = deletionSchedules.save(DeletionSchedule.create(accountId, now, purgeAt, summary))

        refreshSessions.revokeByAccount(accountId, now)           // 전 기기 로그아웃(BR-U0-23)
        locationConsent.purgeForAccountDeletion(accountId)        // GPS 발자취 즉시 파기(FD-U1-07)
        eventPublisher.publish(AccountDeletionRequested(accountId.value.toString(), schedule.deletionId.toString(), purgeAt))

        return DeletionRequestResult(purgeAt, summary)
    }

    @Transactional
    fun cancelDeletion(accountId: AccountId) {
        val schedule = deletionSchedules.findActive(accountId)
            ?: throw ResourceNotFound("철회할 삭제 요청이 없습니다.")
        val account = accounts.findById(accountId) ?: throw AuthenticationRequired()
        accounts.save(account.cancelDeletion()) // DELETION_PENDING → ACTIVE (아니면 ConflictDetected)
        deletionSchedules.save(schedule.cancel(clock.instant()))
        eventPublisher.publish(AccountDeletionCancelled(accountId.value.toString(), schedule.deletionId.toString()))
        // GPS 는 복원하지 않는다(INV-D2 — 이미 파기됨).
    }

    companion object {
        val GRACE_PERIOD: Duration = Duration.ofDays(30)
    }
}
