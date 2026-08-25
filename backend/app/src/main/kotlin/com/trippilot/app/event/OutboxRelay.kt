package com.trippilot.app.event

import com.trippilot.core.event.EventEnvelope
import com.trippilot.core.event.OutboxSubscriber
import net.javacrumbs.shedlock.spring.annotation.SchedulerLock
import org.slf4j.LoggerFactory
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.scheduling.annotation.Scheduled
import org.springframework.stereotype.Component
import java.sql.ResultSet
import java.util.UUID

/**
 * 아웃박스 릴레이(TRIP-539) — 적재된 이벤트를 [OutboxSubscriber] 에게 배달한다.
 *
 * ## 왜 폴링인가
 *
 * 브로커(Kafka·SQS)는 운영 축을 통째로 추가한다. 이 규모에서는 아웃박스 + DB 폴링으로 충분하고,
 * 발송량이 폴링으로 감당 안 될 때 재평가한다(U6 tech-stack §4).
 * 선례도 이미 있다 — `StalePartialSweeper` 가 같은 형태로 돈다.
 *
 * ## 락이 왜 필요한가
 *
 * 다중 인스턴스에서 둘이 같은 행을 집으면 **푸시가 두 번 나간다**. ShedLock 테이블은 V1.0 부터
 * 있었는데 라이브러리가 없어 아무도 쓰지 못했다 — 이 티켓에서 붙였다.
 *
 * ## at-least-once 이지 exactly-once 가 아니다
 *
 * 배달 후 `published_at` 을 찍기 전에 프로세스가 죽으면 다음 폴링이 **다시 배달**한다.
 * 그래서 구독자가 `eventId` 로 멱등을 보장해야 한다([OutboxSubscriber] 계약).
 * 순서를 바꾸면(먼저 표시 → 배달) 이번엔 **한 번도 안 가는** 경우가 생긴다 — 중복이 유실보다 낫다.
 */
@Component
class OutboxRelay(
    private val jdbc: JdbcTemplate,
    subscribers: List<OutboxSubscriber>,
) {
    /** 타입당 여럿일 수 있다 — 한 이벤트를 여러 소비자가 본다. */
    private val byType: Map<String, List<OutboxSubscriber>> = subscribers.groupBy { it.eventType }

    @Scheduled(fixedDelayString = "\${trippilot.outbox.relay-delay-ms:2000}")
    // lockAtMostFor 는 **죽은 인스턴스가 락을 영원히 붙잡는 것**을 막는 안전망이다.
    // lockAtLeastFor 는 0 이다 — cron 방식의 시계 오차 이중 실행을 막는 장치인데 여기는 fixedDelay 라
    // 같은 인스턴스가 겹쳐 돌지 않고, 0 이 아니면 **연속 호출이 조용히 건너뛰어진다**(테스트에서 겪었다).
    @SchedulerLock(name = "outbox-relay", lockAtMostFor = "PT1M", lockAtLeastFor = "PT0S")
    fun relay() {
        if (byType.isEmpty()) return // 구독자가 없으면 행을 집지 않는다 — 집으면 발행 표시만 하고 버리는 셈이다

        val batch = jdbc.query(
            """
            SELECT event_id, event_type, schema_version, aggregate_type, aggregate_id,
                   correlation_id, payload, occurred_at
              FROM outbox_event
             WHERE published_at IS NULL AND attempts < ?
             ORDER BY occurred_at
             LIMIT ?
            """.trimIndent(),
            { rs, _ -> rs.toEnvelope() },
            MAX_ATTEMPTS, BATCH_SIZE,
        )
        if (batch.isEmpty()) return

        batch.forEach { envelope ->
            val targets = byType[envelope.eventType]
            if (targets == null) {
                // 아무도 안 듣는 이벤트다. 계속 집어 올리면 배치가 그것으로 채워져 뒤가 밀린다.
                markPublished(envelope.eventId)
                return@forEach
            }
            runCatching { targets.forEach { it.handle(envelope) } }
                .onSuccess { markPublished(envelope.eventId) }
                .onFailure { e ->
                    val attempts = bumpAttempts(envelope.eventId)
                    // 상한에 닿으면 조용히 사라지지 않게 올린다 — dead-letter 테이블 없이 조회로 찾는다.
                    if (attempts >= MAX_ATTEMPTS) {
                        log.error("이벤트 배달을 포기합니다 — eventId={} type={} attempts={}", envelope.eventId, envelope.eventType, attempts, e)
                    } else {
                        log.warn("이벤트 배달 실패 — 재시도합니다. eventId={} attempts={}", envelope.eventId, attempts, e)
                    }
                }
        }
    }

    private fun markPublished(eventId: UUID) =
        jdbc.update("UPDATE outbox_event SET published_at = now() WHERE event_id = ?", eventId)

    /** 증가된 값을 돌려준다 — 상한 판정을 다시 조회하지 않게. */
    private fun bumpAttempts(eventId: UUID): Int = jdbc.queryForObject(
        "UPDATE outbox_event SET attempts = attempts + 1 WHERE event_id = ? RETURNING attempts",
        Int::class.java, eventId,
    ) ?: 0

    private fun ResultSet.toEnvelope() = EventEnvelope(
        eventId = getObject("event_id", UUID::class.java),
        eventType = getString("event_type"),
        schemaVersion = getInt("schema_version"),
        aggregateType = getString("aggregate_type"),
        aggregateId = getString("aggregate_id"),
        correlationId = getString("correlation_id"),
        occurredAt = getTimestamp("occurred_at").toInstant(),
        payload = getString("payload"),
    )

    private companion object {
        private val log = LoggerFactory.getLogger(OutboxRelay::class.java)

        /** 한 번에 집는 양. 크게 잡으면 락을 오래 쥐고, 작으면 밀린 이벤트가 안 빠진다. */
        private const val BATCH_SIZE = 100

        /** 이 횟수를 넘기면 포기한다. 조회로 찾는다 — `WHERE published_at IS NULL AND attempts >= 10`. */
        private const val MAX_ATTEMPTS = 10
    }
}
