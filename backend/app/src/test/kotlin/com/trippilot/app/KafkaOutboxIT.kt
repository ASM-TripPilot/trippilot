package com.trippilot.app

import com.trippilot.app.event.KafkaOutboxBroker
import com.trippilot.app.event.KafkaOutboxConfig
import com.trippilot.app.event.OutboxRelay
import com.trippilot.core.event.DomainEvent
import com.trippilot.core.event.DomainEventPublisher
import com.trippilot.core.event.EventEnvelope
import com.trippilot.core.event.OutboxSubscriber
import com.trippilot.testsupport.AbstractPostgresIntegrationTest
import io.kotest.matchers.collections.shouldContain
import io.kotest.matchers.longs.shouldBeGreaterThan
import io.kotest.matchers.shouldBe
import io.mockk.every
import io.mockk.mockk
import io.mockk.verify
import io.micrometer.core.instrument.MeterRegistry
import io.micrometer.core.instrument.simple.SimpleMeterRegistry
import org.apache.kafka.clients.consumer.ConsumerConfig
import org.apache.kafka.clients.consumer.KafkaConsumer
import org.apache.kafka.common.serialization.StringDeserializer
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.boot.test.context.TestConfiguration
import org.springframework.context.annotation.Bean
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.test.context.DynamicPropertyRegistry
import org.springframework.test.context.DynamicPropertySource
import org.springframework.transaction.PlatformTransactionManager
import org.springframework.transaction.support.TransactionTemplate
import org.testcontainers.kafka.KafkaContainer
import java.time.Clock
import java.time.Duration
import java.time.Instant
import java.util.UUID
import java.util.concurrent.CopyOnWriteArrayList

/**
 * Kafka 모드 아웃박스(TRIP-1469) — 실 브로커(Testcontainers) + 실 DB.
 *
 * 폴링 모드의 배달 규칙(`OutboxRelayIT`)은 그대로이고, 여기서는 **Kafka 모드에서만 달라지는 것**을 본다:
 * 브로커 확인 뒤에만 발행 표시 · 소비자가 같은 구독자에게 배달 · 키 = aggregateId · 소비 실패 재시도 · 브로커 장애 시 배치 중단.
 */
@SpringBootTest(properties = ["trippilot.outbox.broker=kafka"])
class KafkaOutboxIT : AbstractPostgresIntegrationTest() {

    class Recording : OutboxSubscriber {
        override val eventType = PROBE
        val received = CopyOnWriteArrayList<EventEnvelope>()
        /** 적재 → 배달 지연 표본(측정 전용) — 지표 레지스트리는 테스트에서 분위수를 못 낸다(OutboxRelayLatencyShapeTest). */
        val latencies = java.util.concurrent.ConcurrentHashMap<String, Duration>()
        @Volatile var failNext = false
        override fun handle(envelope: EventEnvelope) {
            if (failNext) { failNext = false; error("의도된 소비 실패") }
            received += envelope
            latencies[envelope.aggregateId] = Duration.between(envelope.occurredAt, Instant.now())
        }
    }

    @TestConfiguration
    class Probes {
        @Bean fun kafkaRecordingSubscriber() = Recording()
    }

    private data class Probe(val note: String) : DomainEvent {
        override val eventType = PROBE
        override val aggregateType = "Probe"
        override val aggregateId = note
    }

    @Autowired private lateinit var publisher: DomainEventPublisher
    @Autowired private lateinit var relay: OutboxRelay
    @Autowired private lateinit var jdbc: JdbcTemplate
    @Autowired private lateinit var subscriber: Recording
    @Autowired private lateinit var registry: MeterRegistry
    @Autowired private lateinit var txManager: PlatformTransactionManager

    private val tx by lazy { TransactionTemplate(txManager) }

    @AfterEach
    fun cleanUp() {
        jdbc.update("DELETE FROM outbox_event WHERE event_type = ?", PROBE)
        subscriber.received.clear()
        subscriber.latencies.clear()
        subscriber.failNext = false
    }

    private fun unpublished(note: String) = jdbc.queryForObject(
        "SELECT count(*) FROM outbox_event WHERE aggregate_id = ? AND published_at IS NULL", Int::class.java, note,
    )!!

    private fun relayUntilPublished(note: String) {
        // 같은 컨테이너의 다른 IT 가 남긴 미발행 행이 배치를 채울 수 있다 — 이 행이 발행될 때까지 돌린다(OutboxRelayIT 와 같다).
        repeat(20) { if (unpublished(note) > 0) relay.relay() }
        unpublished(note) shouldBe 0
    }

    private fun awaitReceived(note: String, timeout: Duration = Duration.ofSeconds(30)) {
        val deadline = System.nanoTime() + timeout.toNanos()
        while (subscriber.received.none { it.aggregateId == note } && System.nanoTime() < deadline) Thread.sleep(50)
        subscriber.received.map { it.aggregateId } shouldContain note
    }

    @Test
    fun `릴레이는 브로커로 넘긴 뒤 발행 표시하고, 소비자가 같은 구독자에게 배달하며 지연을 잰다`() {
        val before = registry.find(LATENCY).timer()?.count() ?: 0L
        tx.execute { publisher.publish(Probe("카프카")) }

        relayUntilPublished("카프카")
        awaitReceived("카프카")

        (registry.find(LATENCY).timer()!!.count()) shouldBeGreaterThan before
    }

    @Test
    fun `메시지 키는 aggregateId 다 — 같은 집합체는 같은 파티션에 들어간다`() {
        tx.execute { publisher.publish(Probe("키-확인")) }
        relayUntilPublished("키-확인")
        val eventId = jdbc.queryForObject(
            "SELECT event_id FROM outbox_event WHERE aggregate_id = ?", UUID::class.java, "키-확인",
        )!!

        KafkaConsumer<String, String>(
            mapOf(
                ConsumerConfig.BOOTSTRAP_SERVERS_CONFIG to kafka.bootstrapServers,
                ConsumerConfig.GROUP_ID_CONFIG to "key-probe-${UUID.randomUUID()}",
                ConsumerConfig.AUTO_OFFSET_RESET_CONFIG to "earliest",
            ),
            StringDeserializer(), StringDeserializer(),
        ).use { consumer ->
            consumer.subscribe(listOf(KafkaOutboxConfig.TOPIC))
            val deadline = System.nanoTime() + Duration.ofSeconds(30).toNanos()
            var key: String? = null
            while (key == null && System.nanoTime() < deadline) {
                key = consumer.poll(Duration.ofMillis(500)).firstOrNull { it.value().contains(eventId.toString()) }?.key()
            }
            key shouldBe "키-확인"
        }
    }

    @Test
    fun `소비가 한 번 실패해도 재시도로 배달된다`() {
        subscriber.failNext = true
        tx.execute { publisher.publish(Probe("재시도")) }

        relayUntilPublished("재시도")
        awaitReceived("재시도") // 첫 재시도는 2초 뒤

        subscriber.failNext shouldBe false // 실패가 실제로 한 번 일어났다
    }

    @Test
    fun `브로커가 실패하면 발행 표시하지 않고, 그 배치의 나머지는 보내지 않는다`() {
        tx.execute {
            publisher.publish(Probe("장애-1"))
            publisher.publish(Probe("장애-2"))
        }
        val down = mockk<KafkaOutboxBroker>()
        every { down.send(any()) } throws IllegalStateException("의도된 브로커 장애")
        // 실제 릴레이와 같은 테이블·같은 구독자 집합 — 브로커만 실패하는 것으로 바꾼다.
        OutboxRelay(jdbc, SimpleMeterRegistry(), listOf(subscriber), Clock.systemUTC(), down).relay()

        verify(exactly = 1) { down.send(any()) } // 첫 실패에서 멈췄다 — 행마다 송신 시한을 기다리지 않는다
        unpublished("장애-1") shouldBe 1
        unpublished("장애-2") shouldBe 1
    }

    /**
     * 폴링 배달 vs Kafka 배달의 적재 → 배달 지연(OBS-U6-01) — **측정 전용**, `MEASURE_OUTBOX=1` 일 때만 돈다(약 1분 40초).
     *
     * 두 모드 모두 운영과 같은 2초 주기로 릴레이를 돌리고, 이벤트를 무작위 간격으로 적재해 구독자가 받은 시각으로 잰다.
     * 판정은 하지 않는다 — 수치를 출력만 한다(PR·회고에 옮긴다).
     */
    @Test
    @EnabledIfEnvironmentVariable(named = "MEASURE_OUTBOX", matches = "1")
    fun `측정 - 폴링 배달과 Kafka 배달의 지연 분포`() {
        val polling = Recording()
        val pollingRelay = OutboxRelay(jdbc, SimpleMeterRegistry(), listOf(polling), Clock.systemUTC())
        val pollingResult = measure("폴링", polling) { pollingRelay.relay() }
        val kafkaResult = measure("카프카", subscriber) { relay.relay() }
        println("[OUTBOX-LATENCY] $pollingResult")
        println("[OUTBOX-LATENCY] $kafkaResult")
    }

    private fun measure(mode: String, sink: Recording, tick: () -> Unit): String {
        val count = 100
        val stop = java.util.concurrent.atomic.AtomicBoolean(false)
        val ticker = Thread {
            while (!stop.get()) { runCatching(tick); Thread.sleep(2_000) } // 운영 기본 fixedDelay 2초
        }.apply { isDaemon = true; start() }
        try {
            val random = java.util.Random(42)
            repeat(count) { i ->
                tx.execute { publisher.publish(Probe("측정-$mode-$i")) }
                Thread.sleep(random.nextLong(0, 800)) // 평균 0.4초 — 틱 사이 어디에나 떨어지게
            }
            val deadline = System.nanoTime() + Duration.ofSeconds(30).toNanos()
            while (sink.latencies.keys.count { it.startsWith("측정-$mode-") } < count && System.nanoTime() < deadline) Thread.sleep(50)
        } finally {
            stop.set(true); ticker.join()
        }
        val ms = sink.latencies.filterKeys { it.startsWith("측정-$mode-") }.values.map { it.toMillis() }.sorted()
        fun pct(p: Double) = ms[((ms.size - 1) * p).toInt()]
        return "$mode n=${ms.size}/$count p50=${pct(0.5)}ms p95=${pct(0.95)}ms max=${ms.last()}ms"
    }

    companion object {
        private const val PROBE = "test.KafkaProbe"
        private const val LATENCY = "trippilot.outbox.relay.latency"

        private val kafka: KafkaContainer by lazy { KafkaContainer("apache/kafka:4.1.1").also { it.start() } }

        @JvmStatic
        @DynamicPropertySource
        fun kafkaProperties(registry: DynamicPropertyRegistry) {
            registry.add("spring.kafka.bootstrap-servers") { kafka.bootstrapServers }
        }
    }
}
