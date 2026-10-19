package com.trippilot.app.event

import com.fasterxml.jackson.databind.ObjectMapper
import com.trippilot.core.event.EventEnvelope
import org.apache.kafka.clients.admin.NewTopic
import org.slf4j.LoggerFactory
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Configuration
import org.springframework.kafka.annotation.KafkaListener
import org.springframework.kafka.config.TopicBuilder
import org.springframework.kafka.core.KafkaTemplate
import org.springframework.kafka.listener.DefaultErrorHandler
import org.springframework.kafka.support.ExponentialBackOffWithMaxRetries
import org.springframework.stereotype.Component
import java.util.concurrent.TimeUnit

/**
 * 아웃박스 → Kafka → 구독자(TRIP-1469). **`trippilot.outbox.broker=kafka`(env `EVENT_BROKER`)일 때만 뜬다** —
 * 기본(none)은 이 파일의 빈이 하나도 없고, 브로커에 연결하지 않는다.
 *
 * 흐름: 업무 트랜잭션이 아웃박스에 적재(그대로) → [OutboxRelay] 폴링이 [KafkaOutboxBroker] 로 넘기고 브로커 확인 뒤
 * 발행 표시 → [KafkaOutboxListener] 가 같은 구독자([com.trippilot.core.event.OutboxSubscriber])에게 배달.
 * 구독자 코드는 바뀌지 않는다 — 배달 계약(at-least-once, `eventId` 멱등)이 같기 때문이다.
 *
 * 키는 `aggregateId` 다 — 같은 여행·계정의 이벤트가 한 파티션에 들어가, **브로커에 들어간 뒤로는** 순서대로 배달된다.
 * 순서 보장이 아니다: 송신에 실패한 행은 백오프로 뒤로 밀려 같은 집합체의 다음 이벤트가 먼저 나갈 수 있다(폴링 모드도
 * 순서를 보장하지 않는다 — 구독자 계약에 순서가 없다). 대가로 한 이벤트의 소비가 재시도 중이면 같은 파티션의 뒤
 * 이벤트가 기다린다(폴링 모드는 행마다 따로 백오프한다).
 */
@Configuration
@ConditionalOnProperty(name = ["trippilot.outbox.broker"], havingValue = "kafka")
class KafkaOutboxConfig {

    @Bean
    fun outboxTopic(): NewTopic = TopicBuilder.name(TOPIC).partitions(PARTITIONS).replicas(1).build()

    /**
     * 소비 실패 재시도 — 폴링 모드와 같은 **10회**, 2초부터 두 배씩.
     *
     * 상한을 폴링 모드의 5분이 아니라 30초로 둔다: 재시도는 소비 스레드에서 기다리므로 총 대기(약 3분)가
     * `max.poll.interval.ms`(기본 5분)를 넘으면 브로커가 소비자를 그룹에서 빼고 재배치가 반복된다.
     * 다 실패하면 폴링 모드처럼 오류 로그로 남기고 넘어간다(조회 대신 로그로 찾는다 — 아웃박스 행은 이미 발행 표시다).
     */
    @Bean
    fun outboxConsumerErrorHandler(): DefaultErrorHandler = DefaultErrorHandler(
        { record, e -> log.error("Kafka 이벤트 배달을 포기합니다 — key={} offset={}", record.key(), record.offset(), e) },
        ExponentialBackOffWithMaxRetries(MAX_ATTEMPTS - 1).apply {
            initialInterval = 2_000
            multiplier = 2.0
            maxInterval = 30_000
        },
    )

    companion object {
        const val TOPIC = "trippilot.outbox"
        private const val PARTITIONS = 3
        private const val MAX_ATTEMPTS = 10
        private val log = LoggerFactory.getLogger(KafkaOutboxConfig::class.java)
    }
}

@Component
@ConditionalOnProperty(name = ["trippilot.outbox.broker"], havingValue = "kafka")
class KafkaOutboxBroker(
    private val kafka: KafkaTemplate<String, String>,
    private val mapper: ObjectMapper,
) {
    /** 브로커가 받았다고 답할 때까지 기다린다 — 답이 없으면 던지고, 릴레이가 그 행을 백오프 재시도한다. */
    fun send(envelope: EventEnvelope) {
        kafka.send(KafkaOutboxConfig.TOPIC, envelope.aggregateId, mapper.writeValueAsString(envelope))
            .get(SEND_TIMEOUT_SEC, TimeUnit.SECONDS)
    }

    private companion object {
        private const val SEND_TIMEOUT_SEC = 10L
    }
}

@Component
@ConditionalOnProperty(name = ["trippilot.outbox.broker"], havingValue = "kafka")
class KafkaOutboxListener(
    private val relay: OutboxRelay,
    private val mapper: ObjectMapper,
) {
    @KafkaListener(topics = [KafkaOutboxConfig.TOPIC], groupId = "trippilot-outbox")
    fun onMessage(value: String) = relay.consume(mapper.readValue(value, EventEnvelope::class.java))
}
