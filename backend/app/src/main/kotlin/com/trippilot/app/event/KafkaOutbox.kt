package com.trippilot.app.event

import com.fasterxml.jackson.core.JsonProcessingException
import com.fasterxml.jackson.databind.DeserializationFeature
import com.fasterxml.jackson.databind.ObjectMapper
import com.trippilot.core.event.EventEnvelope
import org.apache.kafka.clients.admin.NewTopic
import org.apache.kafka.common.errors.RecordTooLargeException
import org.apache.kafka.common.errors.SerializationException
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
import java.util.UUID
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
        broker: KafkaOutboxBroker,
        @Value("\${trippilot.outbox.kafka.retry-initial-ms:2000}") initialMs: Long,
        @Value("\${trippilot.outbox.kafka.retry-max-ms:30000}") maxMs: Long,
    ): DefaultErrorHandler = DefaultErrorHandler(
        { record, e ->
            // 봉투 전체를 못 읽어도 eventId 만 읽히면 그 행을 포기로 남긴다 — 행은 송신 때 이미 발행 표시라 버리면 흔적이 없다.
            val value = record.value() as? String
            val (eventId, eventType) = value?.let(broker::idAndTypeOf) ?: (null to null)
            // 포기 기록이 실패해도(DB 끊김) 던지지 않는다 — 던지면 같은 레코드가 재시도 주기를 처음부터 다시 돌며 파티션을 막는다.
            // 그때 흔적은 이 로그 한 줄(eventId 포함)이다.
            if (eventId != null) runCatching { relay.abandon(eventId, eventType, e) }
                .onFailure { log.error("포기 기록에 실패했습니다 — 이 이벤트는 로그로만 남습니다. eventId={} type={}", eventId, eventType, it) }
            else log.error("eventId 도 못 읽은 Kafka 메시지를 버립니다 — key={} offset={} value={}",
                record.key(), record.offset(), value?.take(500), e)
        },
        ExponentialBackOffWithMaxRetries(OutboxRelay.MAX_ATTEMPTS - 1).apply {
            initialInterval = initialMs
            multiplier = 2.0
            maxInterval = maxMs
        },
    ).apply { addNotRetryableExceptions(JsonProcessingException::class.java) }

    companion object {
        const val TOPIC = "trippilot.outbox"
        private const val PARTITIONS = 3
        private val log = LoggerFactory.getLogger(KafkaOutboxConfig::class.java)
    }
}

@Component
@ConditionalOnProperty(name = ["trippilot.outbox.broker"], havingValue = "kafka")
class KafkaOutboxBroker(
    private val kafka: KafkaTemplate<String, String>,
    private val mapper: ObjectMapper,
) {
    /**
     * 봉투 읽기 — 쓰는 쪽과 **같은 매퍼**로 읽는다(설정이 바뀌어도 둘이 어긋나지 않게). 모르는 필드는 건너뛴다 —
     * 롤링 배포 중 새 인스턴스가 봉투에 필드를 더해 보내도 옛 인스턴스가 읽는다.
     */
    private val reader = mapper.readerFor(EventEnvelope::class.java).without(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES)

    fun read(value: String): EventEnvelope = reader.readValue(value)

    /** 봉투 전체를 못 읽을 때 eventId·eventType 만이라도 — eventId 가 없으면 null. */
    fun idAndTypeOf(value: String): Pair<UUID, String?>? = runCatching {
        val node = mapper.readTree(value)
        UUID.fromString(node.get("eventId").asText()) to node.get("eventType")?.asText()
    }.getOrNull()

    /** 브로커가 받았다고 답할 때까지 기다린다 — 답이 없으면 던지고, 릴레이가 배치를 멈추거나 그 행을 백오프시킨다. */
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

        /**
         * 그 레코드만의 영구 실패인가(크기 초과·직렬화) — 그 행만 백오프시키고 배치는 계속한다. 그 밖은(시한·연결·인증·권한·
         * 닫힌 프로듀서·중단) 모든 송신에 똑같이 걸리므로 배치를 멈추고 시도 횟수를 쓰지 않는다. 반대로 나열하면(브로커 탓만 나열)
         * 빠진 예외 계열 하나가 멀쩡한 이벤트 전부를 13분 만에 포기로 떨어뜨린다.
         */
        fun recordOnly(e: Throwable): Boolean = generateSequence(e) { it.cause }
            .any { it is RecordTooLargeException || it is SerializationException || it is JsonProcessingException }
    }
}

@Component
@ConditionalOnProperty(name = ["trippilot.outbox.broker"], havingValue = "kafka")
class KafkaOutboxListener(private val relay: OutboxRelay, private val broker: KafkaOutboxBroker) {
    @KafkaListener(topics = [KafkaOutboxConfig.TOPIC], groupId = "trippilot-outbox")
    // 값 없는 레코드(tombstone)는 여기까지 오지 않는다 — 스프링이 인자 변환에서 비재시도 실패로 분류해 회수기로 바로 보낸다
    // (실측: "eventId 도 못 읽은 … value=null" 한 줄, 재시도 0). KafkaOutboxIT 가 그 동작을 지킨다.
    fun onMessage(value: String) = relay.consume(broker.read(value))
}
