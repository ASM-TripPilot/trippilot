package com.trippilot.app.event

import com.trippilot.core.event.EventEnvelope
import com.trippilot.core.event.OutboxStore
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.stereotype.Component

/**
 * [OutboxStore] 의 JDBC 구현(TRIP-539).
 *
 * JPA 가 아니라 JdbcTemplate 인 이유: 아웃박스는 **엔티티가 아니다.** 영속 컨텍스트에 올려 두면
 * 플러시 순서에 얽히고, 업무 애그리거트와 같은 세션을 공유해 예상 못 한 시점에 나간다.
 * 여기 필요한 것은 "이 트랜잭션에 INSERT 한 줄"뿐이다.
 *
 * 트랜잭션은 **호출자 것을 그대로 탄다** — `@Transactional` 을 붙이지 않는다. 붙이면 업무 변경과
 * 갈라져 "업무는 롤백됐는데 이벤트는 남는" 상태가 생기고, 그건 아웃박스를 쓰는 이유를 없앤다.
 */
@Component
class JdbcOutboxStore(
    private val jdbc: JdbcTemplate,
) : OutboxStore {

    override fun append(envelope: EventEnvelope) {
        jdbc.update(
            """
            INSERT INTO outbox_event
                (event_id, event_type, schema_version, aggregate_type, aggregate_id,
                 correlation_id, payload, occurred_at)
            VALUES (?, ?, ?, ?, ?, ?, ?::jsonb, ?)
            ON CONFLICT (event_id) DO NOTHING
            """.trimIndent(),
            envelope.eventId,
            envelope.eventType,
            envelope.schemaVersion,
            envelope.aggregateType,
            envelope.aggregateId,
            envelope.correlationId,
            envelope.payload,
            java.sql.Timestamp.from(envelope.occurredAt),
        )
    }
}
