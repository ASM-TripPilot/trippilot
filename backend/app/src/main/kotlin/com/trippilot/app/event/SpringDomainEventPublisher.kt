package com.trippilot.app.event

import com.fasterxml.jackson.databind.ObjectMapper
import com.trippilot.app.web.CorrelationIdFilter
import com.trippilot.core.event.DomainEvent
import com.trippilot.core.event.DomainEventPublisher
import com.trippilot.core.event.EventEnvelope
import com.trippilot.core.event.OutboxStore
import org.slf4j.LoggerFactory
import org.slf4j.MDC
import org.springframework.context.ApplicationEventPublisher
import org.springframework.stereotype.Component
import org.springframework.transaction.support.TransactionSynchronizationManager
import java.time.Clock
import java.util.UUID

/**
 * [DomainEventPublisher] 구현 — **인프로세스 발행 + 아웃박스 적재**(TRIP-539).
 *
 * ## 왜 둘 다 하나
 *
 * 인프로세스만 있던 시절에는 **업무는 저장됐는데 이벤트는 사라진** 구간이 있었다(발행 직후 프로세스
 * 종료). U6 알림은 "누락 0"이 요건이라 그 구간을 없애야 한다.
 *
 * 기존 구독자(`@EventListener`)를 릴레이로 **옮기지 않는다.** 옮기는 순간 같은 이벤트가 두 경로로
 * 가거나 한 경로가 조용히 끊긴다. at-least-once 가 필요한 새 소비자만 [OutboxSubscriber] 로 붙는다.
 *
 * ## 트랜잭션
 *
 * 적재는 **호출자의 트랜잭션을 그대로 탄다** — 업무가 롤백되면 이벤트도 없다. 그것이 트랜잭셔널
 * 아웃박스의 전부다. 호출부가 이미 `@Transactional`·`tx.execute {}` 안이라 성립한다.
 *
 * 트랜잭션 밖에서 불리면 적재만 **독립 커밋**되어, 일어나지 않은 일을 알리게 된다.
 * 그래서 그 경우를 조용히 넘기지 않고 로그로 드러낸다(INV-4).
 */
@Component
class SpringDomainEventPublisher(
    private val delegate: ApplicationEventPublisher,
    private val outbox: OutboxStore,
    private val mapper: ObjectMapper,
    private val clock: Clock,
) : DomainEventPublisher {

    override fun publish(event: DomainEvent) {
        if (!TransactionSynchronizationManager.isActualTransactionActive()) {
            log.warn(
                "트랜잭션 밖에서 이벤트를 발행했습니다 — 업무가 롤백돼도 이 이벤트는 남습니다. type={}",
                event.eventType,
            )
        }
        outbox.append(envelopeOf(event))
        delegate.publishEvent(event)
    }

    private fun envelopeOf(event: DomainEvent) = EventEnvelope(
        eventId = UUID.randomUUID(),
        eventType = event.eventType,
        schemaVersion = event.schemaVersion,
        aggregateType = event.aggregateType,
        aggregateId = event.aggregateId,
        // 요청을 가로질러 추적할 수 있게 상관 id 를 싣는다 — 없으면 릴레이 로그에서 원인 요청을 못 찾는다.
        correlationId = MDC.get(CorrelationIdFilter.MDC_KEY),
        occurredAt = clock.instant(),
        payload = mapper.writeValueAsString(event),
    )

    private companion object {
        private val log = LoggerFactory.getLogger(SpringDomainEventPublisher::class.java)
    }
}
