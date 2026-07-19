package com.trippilot.auth.domain

import java.time.Instant
import java.util.UUID

/**
 * 삭제 유예 예약(V1.4 deletion_schedule). 계정당 활성(cancelled_at IS NULL) 최대 1개(INV-D1).
 * purgeAt = requestedAt + 30일. 실제 파기는 후속 배치가 purge_at 폴링으로 수행(158 스코프 밖).
 */
class DeletionSchedule private constructor(
    val deletionId: UUID,
    val accountId: AccountId,
    val requestedAt: Instant,
    val purgeAt: Instant,
    val cascadeSummary: CascadeSummary,
    val cancelledAt: Instant?,
) {
    val active: Boolean get() = cancelledAt == null

    fun cancel(now: Instant): DeletionSchedule =
        DeletionSchedule(deletionId, accountId, requestedAt, purgeAt, cascadeSummary, cancelledAt = now)

    companion object {
        fun create(accountId: AccountId, requestedAt: Instant, purgeAt: Instant, cascadeSummary: CascadeSummary): DeletionSchedule =
            DeletionSchedule(UUID.randomUUID(), accountId, requestedAt, purgeAt, cascadeSummary, cancelledAt = null)

        fun reconstitute(
            deletionId: UUID,
            accountId: AccountId,
            requestedAt: Instant,
            purgeAt: Instant,
            cascadeSummary: CascadeSummary,
            cancelledAt: Instant?,
        ): DeletionSchedule = DeletionSchedule(deletionId, accountId, requestedAt, purgeAt, cascadeSummary, cancelledAt)
    }
}

/**
 * 연쇄 삭제 범위 고지(deletion_schedule.cascade_summary). U1 스냅샷:
 * 파기 예정 범주 + 법정 보존 범주(동의 증적·위치 법정 로그는 파기하지 않음, INV-D3).
 */
data class CascadeSummary(
    val purgeScheduled: List<String>,
    val legallyRetained: List<String>,
) {
    companion object {
        /** U1 고정 범위 — 실데이터(여행·아카이브 등)는 후속 유닛이라 계정 부속 데이터만. */
        fun forAccount(): CascadeSummary = CascadeSummary(
            purgeScheduled = listOf("PROFILE", "PREFERENCE_SET", "LOCATION_CONSENT_STATE", "MARKETING_CONSENT", "SOCIAL_IDENTITY"),
            legallyRetained = listOf("CONSENT_RECORD", "LOCATION_LEGAL_LOG"),
        )
    }
}
