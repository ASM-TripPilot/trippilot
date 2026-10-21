package com.trippilot.app.event

import com.fasterxml.jackson.core.JsonProcessingException
import com.fasterxml.jackson.databind.DeserializationFeature
import com.fasterxml.jackson.databind.ObjectMapper
import com.trippilot.core.event.EventEnvelope
import org.apache.kafka.clients.admin.NewTopic
import org.apache.kafka.common.config.TopicConfig
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
import org.springframework.messaging.converter.MessageConversionException
import org.springframework.messaging.handler.invocation.MethodArgumentResolutionException
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
    // 보존 무기한 — 행은 송신 때 발행 표시라 미소비 이벤트의 유일한 사본이 토픽이다. 기본 7일이면 오래 내려 둔 사이 지워진다.
    fun outboxTopic(): NewTopic = TopicBuilder.name(TOPIC).partitions(PARTITIONS).replicas(1)
        .config(TopicConfig.RETENTION_MS_CONFIG, "-1").build()

    /**
     * 소비 실패 재시도 — 폴링 모드와 **같은 창**이다: 10회, 2초부터 두 배씩, 간격 상한 5분([OutboxRelay] 의 BACKOFF_*).
     * 대기는 2·4·8·16·32·64·128·256·300초 = 810초(약 13분)로 폴링 모드의 백오프와 한 칸씩 같다.
     *
     * 상한이 5분이어도 `max.poll.interval.ms` 를 넘지 않는다: spring-kafka 4.0.1 의 DefaultErrorHandler 는 실패 **한 번에
     * 간격 하나만** 재우고(FailedRecordTracker.recovered → BackOffHandler.onNextBackOff 1회) 되감은 뒤 다시 poll 한다 —
     * 시도 횟수는 FailedRecordTracker 가 메모리에 센다(jar 의 바이트코드로 확인). 그래서 poll 사이 최대 공백은 간격 상한(5분)
     * + 한 묶음(10건) 처리이고, application.yml 의 `max.poll.interval.ms`(15분)가 그것을 덮는다.
     * 재시도 중에는 같은 파티션의 뒤 이벤트가 기다린다(KafkaOutboxConfig 문서 참고). 재시도 횟수는 메모리에만 있어 앱을
     * 재시작하면 그 레코드는 처음부터 다시 센다(오프셋을 커밋하지 않았으므로 다시 받는다 — 유실은 아니다). 다 쓰면 포기는
     * [OutboxRelay.abandon] 이 폴링 모드와 같은 조회로 찾게 남긴다.
     * 봉투를 못 읽는 메시지는 재시도해도 같으므로 바로 포기한다(파티션을 막지 않게).
     */
    @Bean
    fun outboxConsumerErrorHandler(
        relay: OutboxRelay,
        broker: KafkaOutboxBroker,
        @Value("\${trippilot.outbox.kafka.retry-initial-ms:2000}") initialMs: Long,
        @Value("\${trippilot.outbox.kafka.retry-max-ms:300000}") maxMs: Long,
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
    ).apply {
        // 예외 종류가 바뀌어도 시도 횟수를 이어 센다 — 기본(true)이면 연결 거부·시한 초과가 번갈아 나는 구독자는 매번 0 부터
        // 다시 세어 상한에 영영 닿지 않는다(폴링 모드는 종류와 무관하게 DB 에 센다).
        setResetStateOnExceptionChange(false)
        // 분류표를 **통째로 바꾼다.** 분류는 원인 사슬 전체를 본다(끌 수 없다) — 그래서 기본표의 ClassCastException 같은
        // 범용 타입은 구독자 안에서 난 일시 오류까지 첫 실패에서 포기시킨다(폴링 모드는 10번 재시도한다). 표에는 **구독자
        // 코드가 던질 일이 없는 타입만** 둔다: 봉투를 못 읽음([UnreadableEnvelope]), 그리고 리스너 본문 전에 스프링 메시징·
        // Kafka 변환이 실패한 경우(값 없는 레코드 등).
        setClassifications(
            mapOf(
                UnreadableEnvelope::class.java to false,
                MethodArgumentResolutionException::class.java to false,
                MessageConversionException::class.java to false,
                org.springframework.kafka.support.converter.ConversionException::class.java to false,
            ),
            true,
        )
    }

    companion object {
        const val TOPIC = "trippilot.outbox"
        /** 파티션마다 소비 스레드 하나 — 두 값이 따로 놀면 한 스레드가 두 파티션을 맡아 백오프가 남의 파티션을 막는다. */
        const val CONSUMERS = "3"
        private val PARTITIONS = CONSUMERS.toInt()
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
    // 파티션 수만큼 소비 스레드를 둔다 — 하나면 백오프가 그 스레드를 재워 실패한 이벤트 하나가 세 파티션 전부를 멈춘다.
    // ⚠ 폴링 모드에 없던 동시성이다 — 폴링은 ShedLock 으로 한 번에 한 릴레이만 차례로 배달한다. 여기서는 키(aggregateId)가
    // 다른 이벤트가 동시에 구독자를 탄다. (순서 뒤바뀜은 새것이 아니다 — 폴링도 행마다 백오프해 순서가 바뀐다.)
    // TRIP-1469 에서 구독자 전부(OutboxSubscriber 구현 16개)를 동시 호출 기준으로 확인했다:
    //  - 리마인드 재적재(ItineraryGenerated 키=itineraryId · ItineraryRecalculated·TripDeleted 키=tripId → reload):
    //    여행 권고 잠금(lockTrip) 뒤 현재 상태로 다시 계산 — 누가 먼저 오든 마지막 커밋이 최신 상태다.
    //  - 알림 적재(StayRegistered·PlanBTriggered·ReflectionReady → raise): source_event_id UNIQUE(ON CONFLICT). Plan-B 묶음
    //    푸시(같은 여행, 키=triggerId 라 갈린다)만 단일 실행에 기대고 있었다 → lockPushGroup 으로 고쳤다(DomainNotificationIT).
    //    발송(PushDispatchService.dispatch)의 계정 발송량 상한은 "세고→보내기"라, 같은 계정의 다른 키 사건(숙소 등록·회고·다른
    //    여행의 Plan-B)이 함께 지나면 폴링 모드보다 계정당 최대 (CONSUMERS − 1)건 더 나갈 수 있다(dispatch 는 인스턴스마다
    //    도는 리마인드 발화 폴러도 부르니, 상한 대비 절대 초과는 그 겹침까지 더한 값이다). 잠그지 않는다 — PushRateLimits KDoc
    //    "소폭 초과는 설계상 허용이다"(COST-U6-01·02: 하드 쿼터가 아니라 폭주 차단)의 범위 안이다.
    //  - 회고(TripEnded 키=tripId → 요약 생성 · ActualRouteStored 키=routeDayId → 통계 갱신): 같은 여행·같은 날 권고 잠금
    //    (TripSummaryPersistence·ReflectionPersistence.findForUpdate) — 요약이 아직 없어도 잠금이 줄 세운다.
    //  - Plan-B 선계산(PlanBTriggered → onRisk): 부분 유니크 + 자리 세마포어 — 사용자 요청과의 동시성을 이미 견딘다.
    //  - 트리거 소비(ItineraryRecalculated → TriggerService.consume): 트리거를 쓰는 구독자는 이것 하나라 구독자끼리 겹치지 않는다.
    //  - 파기(도우미 대화 TripDeleted·AccountDeletionRequested·DialogueForgetRequested · EXIF·경로·기준점 좌표·위치 구간 닫기):
    //    멱등 DELETE·조건부 UPDATE. GpsRecordingOptOut·LocationLegalConsentRevoked 는 키가 같은 accountId 라 한 파티션이다.
    // 새 구독자는 동시 호출을 전제로 쓴다 — 선검사 후 쓰기에는 잠금·유니크를 둔다.
    @KafkaListener(topics = [KafkaOutboxConfig.TOPIC], groupId = "trippilot-outbox", concurrency = KafkaOutboxConfig.CONSUMERS)
    // 값 없는 레코드(tombstone)는 여기까지 오지 않는다 — 스프링이 인자 변환에서 비재시도 실패로 분류해 회수기로 바로 보낸다
    // (실측: "eventId 도 못 읽은 … value=null" 한 줄, 재시도 0). KafkaOutboxIT 가 그 동작을 지킨다.
    fun onMessage(value: String) {
        val envelope = runCatching { broker.read(value) }.getOrElse { throw UnreadableEnvelope(it) }
        relay.consume(envelope)
    }
}

/** 봉투를 못 읽었다 — 재시도해도 같으므로 바로 포기한다. 구독자 안에서 난 예외와 구분하려고 따로 둔다. */
class UnreadableEnvelope(cause: Throwable) : RuntimeException("Kafka 메시지의 봉투를 읽지 못했습니다", cause)
