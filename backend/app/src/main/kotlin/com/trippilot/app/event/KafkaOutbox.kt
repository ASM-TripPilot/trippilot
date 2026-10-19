package com.trippilot.app.event

import com.fasterxml.jackson.core.JsonProcessingException
import com.fasterxml.jackson.databind.DeserializationFeature
import com.fasterxml.jackson.databind.ObjectMapper
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule
import com.fasterxml.jackson.module.kotlin.kotlinModule
import com.trippilot.core.event.EventEnvelope
import org.apache.kafka.clients.admin.NewTopic
import org.apache.kafka.common.errors.RetriableException
import org.slf4j.LoggerFactory
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty
import org.springframework.beans.factory.annotation.Value
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
     * 소비 실패 재시도 — 횟수는 폴링 모드와 같은 **10회**, 2초부터 두 배씩. **재시도 창은 폴링보다 짧다**(약 3분 vs 13분).
     *
     * 상한을 폴링 모드의 5분이 아니라 30초로 둔다: 재시도는 소비 스레드에서 기다리므로 총 대기가
     * `max.poll.interval.ms`(기본 5분)를 넘으면 브로커가 소비자를 그룹에서 빼고 재배치가 반복된다. 대가로 3~13분짜리
     * 장애는 폴링 모드라면 넘기지만 여기서는 포기된다 — 포기는 [OutboxRelay.abandon] 이 폴링 모드와 같은 조회로 찾게 남긴다.
     * 재시도 중에는 같은 파티션의 뒤 이벤트가 기다린다(KafkaOutboxConfig 문서 참고).
     * 봉투를 못 읽는 메시지는 재시도해도 같으므로 바로 포기한다(파티션을 막지 않게).
     */
    @Bean
    fun outboxConsumerErrorHandler(
        relay: OutboxRelay,
        @Value("\${trippilot.outbox.kafka.retry-initial-ms:2000}") initialMs: Long,
        @Value("\${trippilot.outbox.kafka.retry-max-ms:30000}") maxMs: Long,
    ): DefaultErrorHandler = DefaultErrorHandler(
        { record, e ->
            val envelope = runCatching { readEnvelope(record.value() as String) }.getOrNull()
            if (envelope != null) relay.abandon(envelope, e)
            else log.error("봉투를 읽지 못한 Kafka 메시지를 버립니다 — key={} offset={} value={}",
                record.key(), record.offset(), (record.value() as? String)?.take(500), e)
        },
        ExponentialBackOffWithMaxRetries(MAX_ATTEMPTS - 1).apply {
            initialInterval = initialMs
            multiplier = 2.0
            maxInterval = maxMs
        },
    ).apply { addNotRetryableExceptions(JsonProcessingException::class.java) }

    companion object {
        const val TOPIC = "trippilot.outbox"
        private const val PARTITIONS = 3
        private const val MAX_ATTEMPTS = 10
        private val log = LoggerFactory.getLogger(KafkaOutboxConfig::class.java)

        /**
         * 봉투 읽기. 모르는 필드는 건너뛴다 — 롤링 배포 중 새 인스턴스가 봉투에 필드를 더해 보내도 옛 인스턴스가 읽는다.
         * 봉투는 UUID·Instant·문자열뿐이라 앱 매퍼의 설정이 필요 없다(Kotlin·java.time 모듈만).
         */
        private val envelopeReader = ObjectMapper().registerModule(kotlinModule()).registerModule(JavaTimeModule())
            .readerFor(EventEnvelope::class.java).without(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES)

        fun readEnvelope(value: String): EventEnvelope = envelopeReader.readValue(value)
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

    companion object {
        /**
         * 프로듀서 자신의 시한(max.block 5초 + delivery.timeout 10초, application.yml)보다 길게 — 짧으면 프로듀서가 아직
         * 보내는 중인 것을 실패로 보고 다시 보내 같은 이벤트가 두 번 들어간다.
         */
        private const val SEND_TIMEOUT_SEC = 20L

        /** 브로커에 닿지 못한 실패인가 — 그렇다면 같은 배치의 다음 송신도 같은 시한을 기다릴 뿐이다. */
        fun unreachable(e: Throwable): Boolean = generateSequence(e) { it.cause }
            .any { it is RetriableException || it is java.util.concurrent.TimeoutException || it is InterruptedException }
    }
}

@Component
@ConditionalOnProperty(name = ["trippilot.outbox.broker"], havingValue = "kafka")
class KafkaOutboxListener(private val relay: OutboxRelay) {
    @KafkaListener(topics = [KafkaOutboxConfig.TOPIC], groupId = "trippilot-outbox")
    fun onMessage(value: String) = relay.consume(KafkaOutboxConfig.readEnvelope(value))
}
