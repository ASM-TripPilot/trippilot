package com.trippilot.core.event

/**
 * 인프로세스 도메인 이벤트 발행 계약(U1-내부아키텍처 §2).
 * 모듈은 이 인터페이스에만 의존(DIP) — Spring 기반 구현은 app 이 제공한다.
 * 구독자는 [DomainEvent.eventType]/멱등키 기준으로 중복 제거한다(계약).
 */
interface DomainEventPublisher {
    fun publish(event: DomainEvent)
}
