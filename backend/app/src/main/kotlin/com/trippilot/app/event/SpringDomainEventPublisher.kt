package com.trippilot.app.event

import com.trippilot.core.event.DomainEvent
import com.trippilot.core.event.DomainEventPublisher
import org.springframework.context.ApplicationEventPublisher
import org.springframework.stereotype.Component

/**
 * [DomainEventPublisher] 의 인프로세스 구현 — Spring [ApplicationEventPublisher] 위임.
 * Spring 이벤트 시스템을 쓰므로 후속 트랜잭션 바인딩(@TransactionalEventListener → 아웃박스)까지 확장 가능.
 * 구독자는 각 [DomainEvent] 구현 타입에 @EventListener 로 반응한다.
 */
@Component
class SpringDomainEventPublisher(
    private val delegate: ApplicationEventPublisher,
) : DomainEventPublisher {
    override fun publish(event: DomainEvent) {
        delegate.publishEvent(event)
    }
}
