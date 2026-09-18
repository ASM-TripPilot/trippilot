package com.trippilot.auth.api.event

import com.trippilot.core.event.DomainEvent
import java.time.Instant

/**
 * 계정 삭제 요청 — 감사·GPS 파기 훅·연쇄 삭제 예약이 소비(U1-내부아키텍처 §2.3).
 * 실제 30일 배치 파기는 후속(스케줄러) — 이 이벤트는 예약·훅 신호.
 */
data class AccountDeletionRequested(
    override val aggregateId: String,
    val deletionId: String,
    val purgeAt: Instant,
) : DomainEvent {
    override val eventType: String = "auth.AccountDeletionRequested"
    override val aggregateType: String = "Account"
}

/** 계정 삭제 철회(유예 내 복원) — 감사가 소비. */
data class AccountDeletionCancelled(
    override val aggregateId: String,
    val deletionId: String,
) : DomainEvent {
    override val eventType: String = "auth.AccountDeletionCancelled"
    override val aggregateType: String = "Account"
}
