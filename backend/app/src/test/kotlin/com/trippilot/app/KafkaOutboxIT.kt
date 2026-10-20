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
// 재시도 간격만 줄인다(소진 경로를 끝까지 돌리려고 — 기본 2초·5분이면 약 13분이다). 10회·두 배는 운영과 같다:
// 소진까지 약 17초, 재시도했다면 독 메시지 테스트가 그만큼 막힌다.
@SpringBootTest(properties = [
    "trippilot.outbox.broker=kafka",
    "trippilot.outbox.kafka.retry-initial-ms=1000",
    "trippilot.outbox.kafka.retry-max-ms=2000",
])
class KafkaOutboxIT : AbstractPostgresIntegrationTest() {

    class Recording : OutboxSubscriber {
        override val eventType = PROBE
        val received = CopyOnWriteArrayList<EventEnvelope>()
        /** 적재 → 배달 지연 표본(측정 전용) — 지표 레지스트리는 테스트에서 분위수를 못 낸다(OutboxRelayLatencyShapeTest). */
        val latencies = java.util.concurrent.ConcurrentHashMap<String, Duration>()
        @Volatile var failNext = false
        @Volatile var failAlways = false
        /** 계속 실패하되 예외 종류를 번갈아 — 종류가 바뀔 때마다 재시도 횟수가 리셋되면 영영 포기되지 않는다. */
        private var flip = false
        /**
         * 구독자 안에서 범용 타입이 원인인 예외가 한 번 난다 — 재시도 대상이어야 한다. 원인을 ClassCastException 으로 두는
         * 이유: 스프링 기본 즉시 포기 표에 있는 타입이라, 분류표를 바꾸지 않았다면(또는 범용 타입을 표에 넣었다면) 여기서 포기된다.
         */
        @Volatile var failNextWithParse = false
        /** 이 aggregateId 만 계속 실패 — 다른 이벤트는 통과. */
        @Volatile var failOnly: String? = null
        override fun handle(envelope: EventEnvelope) {
            if (failAlways) { flip = !flip; if (flip) error("의도된 계속 실패") else throw java.io.UncheckedIOException(java.io.IOException("의도된 연결 실패")) }
            if (failOnly != null && envelope.aggregateId == failOnly) error("의도된 특정 이벤트 실패")
            if (failNextWithParse) {
                failNextWithParse = false
                throw IllegalStateException("의도된 일시 실패", ClassCastException("구독자 안의 범용 예외"))
            }
            if (failNext) { failNext = false; error("의도된 소비 실패") }
            received += envelope
            latencies[envelope.aggregateId] = Duration.between(envelope.occurredAt, Instant.now())
        }
    }

    /** 손으로 미는 시계. 익명 객체로 두면 클래스 이름에 테스트 이름(괄호)이 들어가 스프링 클래스패스 스캔이 깨진다. */
    class MovableClock(@Volatile var now: Instant) : Clock() {
        override fun getZone(): java.time.ZoneId = java.time.ZoneOffset.UTC
        override fun withZone(zone: java.time.ZoneId?): Clock = this
        override fun instant(): Instant = now
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
    @Autowired private lateinit var allSubscribers: List<OutboxSubscriber>
    @Autowired private lateinit var listeners: org.springframework.kafka.config.KafkaListenerEndpointRegistry
    @Autowired private lateinit var kafkaTemplate: org.springframework.kafka.core.KafkaTemplate<String, String>

    private val tx by lazy { TransactionTemplate(txManager) }

    @AfterEach
    fun cleanUp() {
        jdbc.update("DELETE FROM outbox_event WHERE event_type = ?", PROBE)
        subscriber.received.clear()
        subscriber.latencies.clear()
        subscriber.failNext = false
        subscriber.failAlways = false
        subscriber.failNextWithParse = false
        subscriber.failOnly = null
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

        // 지연은 구독자가 돌아온 **뒤** 기록된다 — 받은 것을 본 직후 바로 읽으면 경합이다. 기록될 때까지 기다린다.
        val deadline = System.nanoTime() + Duration.ofSeconds(10).toNanos()
        while ((registry.find(LATENCY).timer()?.count() ?: 0L) <= before && System.nanoTime() < deadline) Thread.sleep(20)
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
                key = consumer.poll(Duration.ofMillis(500)).firstOrNull { it.value()?.contains(eventId.toString()) == true }?.key()
            }
            key shouldBe "키-확인"
        }
    }

    @Test
    fun `토픽은 보존 무기한이다 — 기동 전에 기본 보존으로 만들어진 토픽도 맞춘다`() {
        // 토픽은 컨텍스트가 뜨기 전에 기본 보존(7일)으로 미리 만들어 둔다(아래 kafka) — 설정 전에 만들어진 로컬 토픽과 같다.
        org.apache.kafka.clients.admin.AdminClient.create(mapOf("bootstrap.servers" to kafka.bootstrapServers)).use { admin ->
            val resource = org.apache.kafka.common.config.ConfigResource(
                org.apache.kafka.common.config.ConfigResource.Type.TOPIC, KafkaOutboxConfig.TOPIC,
            )
            admin.describeConfigs(listOf(resource)).all().get()[resource]!!.get("retention.ms").value() shouldBe "-1"
        }
    }

    @Test
    fun `소비가 한 번 실패해도 재시도로 배달된다`() {
        subscriber.failNext = true
        tx.execute { publisher.publish(Probe("재시도")) }

        relayUntilPublished("재시도")
        awaitReceived("재시도") // 첫 재시도는 1초 뒤(이 IT 의 retry-initial-ms)

        subscriber.failNext shouldBe false // 실패가 실제로 한 번 일어났다
    }

    @Test
    fun `브로커가 실패하면 발행 표시하지 않고, 그 배치의 나머지는 보내지 않는다`() {
        // 다른 IT 가 남긴 미발행 행을 먼저 비운다 — 배치(100건)가 그것으로 차면 이 테스트의 행이 안 들어간다.
        repeat(20) { relay.relay() }
        tx.execute {
            publisher.publish(Probe("장애-1"))
            publisher.publish(Probe("장애-2"))
        }
        val down = mockk<KafkaOutboxBroker>()
        every { down.send(any()) } throws org.apache.kafka.common.errors.TimeoutException("의도된 브로커 장애")
        // 실제 릴레이와 같은 테이블·같은 구독자 집합 — 브로커만 실패하는 것으로 바꾼다.
        OutboxRelay(jdbc, SimpleMeterRegistry(), allSubscribers, Clock.systemUTC(), down).relay()

        verify(exactly = 1) { down.send(any()) } // 첫 실패에서 멈췄다 — 행마다 송신 시한을 기다리지 않는다
        unpublished("장애-1") shouldBe 1
        unpublished("장애-2") shouldBe 1
        // 브로커 장애는 이벤트 탓이 아니다 — 시도 횟수를 쓰면 긴 장애 끝에 멀쩡한 이벤트가 전부 포기로 떨어진다.
        jdbc.queryForObject(
            "SELECT coalesce(sum(attempts), 0) FROM outbox_event WHERE aggregate_id IN ('장애-1', '장애-2')", Int::class.java,
        ) shouldBe 0
    }

    @Test
    fun `레코드만의 실패(크기 초과 등)는 그 행만 미루고 배치의 뒤는 보낸다`() {
        repeat(20) { relay.relay() }
        tx.execute {
            publisher.publish(Probe("영구-1"))
            publisher.publish(Probe("영구-2"))
        }
        val tooLarge = mockk<KafkaOutboxBroker>()
        every { tooLarge.send(any()) } throws org.apache.kafka.common.errors.RecordTooLargeException("의도된 크기 초과")
        OutboxRelay(jdbc, SimpleMeterRegistry(), allSubscribers, Clock.systemUTC(), tooLarge).relay()

        verify(exactly = 2) { tooLarge.send(match { it.aggregateId.startsWith("영구-") }) } // 첫 실패에서 멈추지 않았다
        // 그 행만 백오프 — 시도 1회를 쓰고 미발행으로 남는다(시도를 안 쓰면 매 폴링 맨 앞에서 영영 다시 보낸다).
        listOf("영구-1", "영구-2").forEach { note ->
            jdbc.queryForObject(
                "SELECT attempts FROM outbox_event WHERE aggregate_id = ? AND published_at IS NULL", Int::class.java, note,
            ) shouldBe 1
        }
    }

    @Test
    fun `느린 브로커도 한 배치의 송신 예산(4분)을 넘기면 나머지는 다음 폴링으로 미룬다`() {
        repeat(20) { relay.relay() }
        tx.execute {
            publisher.publish(Probe("예산-1"))
            publisher.publish(Probe("예산-2"))
        }
        // 송신은 성공하지만 한 건마다 5분이 흐른다 — 첫 건 뒤에 예산을 넘긴다.
        val clock = MovableClock(Instant.parse("2026-10-20T00:00:00Z"))
        val slow = mockk<KafkaOutboxBroker>()
        every { slow.send(any()) } answers { clock.now = clock.now.plus(Duration.ofMinutes(5)) }
        OutboxRelay(jdbc, SimpleMeterRegistry(), allSubscribers, clock, slow).relay()

        verify(exactly = 1) { slow.send(any()) }
        jdbc.queryForObject(
            "SELECT count(*) FROM outbox_event WHERE aggregate_id IN ('예산-1', '예산-2') AND published_at IS NULL AND attempts = 0",
            Int::class.java,
        ) shouldBe 1 // 못 보낸 건은 브로커·이벤트 탓이 아니다 — 시도 횟수를 쓰지 않는다
    }

    @Test
    fun `소비 재시도를 다 쓴 이벤트는 폴링 모드의 포기와 같은 조회로 찾힌다`() {
        subscriber.failAlways = true
        tx.execute { publisher.publish(Probe("포기")) }
        relayUntilPublished("포기") // 송신 = 발행 표시

        // 오류 처리기의 재시도 소진 → 회수기 → abandon 까지 실제 배선으로 돈다(약 17초). 예외 종류가 번갈아 나도 이어 센다.
        val abandoned = "SELECT count(*) FROM outbox_event WHERE aggregate_id = ? AND published_at IS NULL AND attempts >= 10"
        val deadline = System.nanoTime() + Duration.ofSeconds(60).toNanos()
        while (jdbc.queryForObject(abandoned, Int::class.java, "포기") == 0 && System.nanoTime() < deadline) Thread.sleep(200)
        jdbc.queryForObject(abandoned, Int::class.java, "포기") shouldBe 1

        subscriber.failAlways = false
        relay.relay() // 시도 상한이라 다시 집히지 않는다
        unpublished("포기") shouldBe 1
    }

    @Test
    fun `이 인스턴스에 구독자가 없는 타입을 받으면 조용히 넘기지 않고 포기로 남긴다`() {
        tx.execute { publisher.publish(Probe("모름")) }
        relayUntilPublished("모름")
        awaitReceived("모름")
        val sent = subscriber.received.first { it.aggregateId == "모름" }

        // 롤링 배포 중 옛 인스턴스가 새 타입을 받은 경우 — 같은 행, 이 인스턴스가 모르는 타입.
        relay.consume(sent.copy(eventType = "test.UnknownHere"))

        jdbc.queryForObject(
            "SELECT count(*) FROM outbox_event WHERE event_id = ? AND published_at IS NULL AND attempts >= 10",
            Int::class.java, sent.eventId,
        ) shouldBe 1
    }

    @Test
    fun `소비자가 표시 전에 포기했으면 릴레이의 발행 표시가 그 포기를 덮지 않는다`() {
        repeat(20) { relay.relay() }
        tx.execute { publisher.publish(Probe("경합")) }
        // 송신이 돌아오기 전에 소비자가 이미 포기한 상황 — 송신 안에서 abandon 을 불러 순서를 고정한다.
        val racing = mockk<KafkaOutboxBroker>()
        every { racing.send(any()) } answers {
            val sent = firstArg<EventEnvelope>()
            relay.abandon(sent.eventId, sent.eventType, IllegalStateException("의도된 선행 포기"))
        }
        OutboxRelay(jdbc, SimpleMeterRegistry(), allSubscribers, Clock.systemUTC(), racing).relay()

        jdbc.queryForObject(
            "SELECT count(*) FROM outbox_event WHERE aggregate_id = ? AND published_at IS NULL AND attempts >= 10",
            Int::class.java, "경합",
        ) shouldBe 1
    }

    @Test
    fun `봉투 모양이 틀려도 eventId 가 읽히면 그 행을 포기로 남긴다`() {
        tx.execute { publisher.publish(Probe("모양")) }
        relayUntilPublished("모양")
        val eventId = jdbc.queryForObject("SELECT event_id FROM outbox_event WHERE aggregate_id = ?", UUID::class.java, "모양")!!

        kafkaTemplate.send(KafkaOutboxConfig.TOPIC, "모양", """{"eventId":"$eventId","occurredAt":"시각 아님"}""").get()

        val abandoned = "SELECT count(*) FROM outbox_event WHERE event_id = ? AND published_at IS NULL AND attempts >= 10"
        val deadline = System.nanoTime() + Duration.ofSeconds(8).toNanos() // 재시도 없이 바로 — 재시도면 17초
        while (jdbc.queryForObject(abandoned, Int::class.java, eventId) == 0 && System.nanoTime() < deadline) Thread.sleep(100)
        jdbc.queryForObject(abandoned, Int::class.java, eventId) shouldBe 1
    }

    @Test
    fun `값 없는 레코드는 건너뛰어 같은 파티션의 뒤 이벤트를 막지 않는다`() {
        // 스프링의 인자 변환 실패(비재시도 기본 분류)에 기대는 동작이다 — 재시도로 바뀌면 17초 막혀 여기서 깨진다.
        kafkaTemplate.send(KafkaOutboxConfig.TOPIC, "빈값", null).get()
        tx.execute { publisher.publish(Probe("빈값")) }
        relayUntilPublished("빈값")

        awaitReceived("빈값", Duration.ofSeconds(8))
    }

    @Test
    fun `구독자 안의 범용 예외는 봉투 문제가 아니다 — 포기하지 않고 재시도해 배달한다`() {
        subscriber.failNextWithParse = true
        tx.execute { publisher.publish(Probe("응답파싱")) }
        relayUntilPublished("응답파싱")

        awaitReceived("응답파싱")
        unpublished("응답파싱") shouldBe 0 // 포기(미발행·상한)로 떨어지지 않았다
    }

    @Test
    fun `송신 뒤 발행 표시가 실패하면 브로커 장애가 아니다 — 시도 횟수를 올려 맨 앞에서 영영 막지 않는다`() {
        repeat(20) { relay.relay() }
        tx.execute { publisher.publish(Probe("표시실패")) }
        val markFails = object : JdbcTemplate(jdbc.dataSource!!) {
            override fun update(sql: String, vararg args: Any?): Int =
                if (sql.contains("SET published_at = now()")) throw org.springframework.dao.DataAccessResourceFailureException("의도된 표시 실패")
                else super.update(sql, *args)
        }
        val ok = mockk<KafkaOutboxBroker>(relaxed = true)
        OutboxRelay(markFails, SimpleMeterRegistry(), allSubscribers, Clock.systemUTC(), ok).relay()

        jdbc.queryForObject("SELECT attempts FROM outbox_event WHERE aggregate_id = ?", Int::class.java, "표시실패") shouldBe 1
    }

    @Test
    fun `한 파티션의 이벤트가 재시도 중이어도 다른 파티션의 이벤트는 기다리지 않는다`() {
        // 구조부터 — 파티션마다 소비 스레드가 따로다. 아래 행동 검증만으로는 못 잡는다: 스레드가 하나여도 poll 묶음 안에서
        // 다른 파티션 레코드가 앞에 오면 먼저 처리되어 통과할 수 있다(실측: concurrency=1 로 바꿔도 통과했다).
        val container = listeners.listenerContainers.single() as org.springframework.kafka.listener.ConcurrentMessageListenerContainer<*, *>
        container.containers.size shouldBe KafkaOutboxConfig.CONSUMERS.toInt()

        // 서로 다른 파티션에 떨어지는 두 키를 고른다(프로듀서 기본 분할: murmur2(key) % 파티션 수).
        fun partition(key: String) = org.apache.kafka.common.utils.Utils.toPositive(
            org.apache.kafka.common.utils.Utils.murmur2(key.toByteArray()),
        ) % 3
        val stuck = "막힘-0"
        val free = (0..50).map { "통과-$it" }.first { partition(it) != partition(stuck) }

        subscriber.failAlways = true
        tx.execute { publisher.publish(Probe(stuck)) }
        relayUntilPublished(stuck)
        Thread.sleep(500) // 막힌 이벤트가 먼저 재시도에 들어가게
        subscriber.failAlways = false.also { subscriber.failOnly = stuck }
        tx.execute { publisher.publish(Probe(free)) }
        relayUntilPublished(free)

        awaitReceived(free, Duration.ofSeconds(5)) // 같은 스레드였다면 막힌 쪽 백오프(1·2초…) 동안 못 온다

        // 막힌 쪽을 풀어 배달까지 기다린다 — 남겨 두면 그 파티션이 재시도로 묶여 뒤 테스트가 기다린다.
        subscriber.failOnly = null
        awaitReceived(stuck)
    }

    @Test
    fun `봉투를 못 읽는 메시지는 재시도 없이 버려 같은 파티션의 뒤 이벤트를 막지 않는다`() {
        kafkaTemplate.send(KafkaOutboxConfig.TOPIC, "독", "{깨진 봉투").get()
        tx.execute { publisher.publish(Probe("독")) } // 같은 키 = 같은 파티션, 깨진 메시지 뒤
        relayUntilPublished("독")

        awaitReceived("독", Duration.ofSeconds(8)) // 재시도했다면 1·2·2…초 백오프로 소진까지 약 17초 걸린다
    }

    /**
     * 폴링 배달 vs Kafka 배달의 적재 → 배달 지연(OBS-U6-01) — **측정 전용**, `MEASURE_OUTBOX=1` 일 때만 돈다(모드당 100건 × 평균 0.4초 간격 — 두 모드 합쳐 1분 남짓).
     *
     * 두 모드 모두 운영과 같은 2초 주기로 릴레이를 돌리고, 이벤트를 무작위 간격으로 적재해 구독자가 받은 시각으로 잰다.
     * 판정은 하지 않는다 — 수치를 출력만 한다(PR·회고에 옮긴다).
     */
    @Test
    @EnabledIfEnvironmentVariable(named = "MEASURE_OUTBOX", matches = "1")
    fun `측정 - 폴링 배달과 Kafka 배달의 지연 분포`() {
        val polling = Recording()
        val pollingRelay = OutboxRelay(jdbc, SimpleMeterRegistry(), allSubscribers.filterNot { it === subscriber } + polling, Clock.systemUTC())
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

        /**
         * 토픽을 **기본 보존으로 미리 만든다** — KafkaAdmin 은 기본으로 토픽을 만들 때만 설정을 쓰므로(modify-topic-configs),
         * 이 설정 전에 만들어진 로컬 토픽은 7일 보존으로 남는다. 기동 뒤 무기한으로 바뀌었는지를 보존 테스트가 본다.
         */
        private val kafka: KafkaContainer by lazy {
            KafkaContainer("apache/kafka:4.1.1").also { container ->
                container.start()
                org.apache.kafka.clients.admin.AdminClient.create(mapOf("bootstrap.servers" to container.bootstrapServers)).use {
                    it.createTopics(listOf(org.apache.kafka.clients.admin.NewTopic(KafkaOutboxConfig.TOPIC, KafkaOutboxConfig.CONSUMERS.toInt(), 1.toShort()))).all().get()
                }
            }
        }

        @JvmStatic
        @DynamicPropertySource
        fun kafkaProperties(registry: DynamicPropertyRegistry) {
            registry.add("spring.kafka.bootstrap-servers") { kafka.bootstrapServers }
        }
    }
}
