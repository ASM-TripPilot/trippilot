package com.trippilot.auth.api.event

import com.trippilot.core.event.DomainEvent

/**
 * 소셜 신규 가입 완료 — 감사·후속 훅이 소비(U1-내부아키텍처 §2.3).
 * api 패키지: 다른 모듈이 구독 가능한 공개 이벤트 계약.
 */
data class AccountCreated(
    override val aggregateId: String,
) : DomainEvent {
    override val eventType: String = "auth.AccountCreated"
    override val aggregateType: String = "Account"
}
