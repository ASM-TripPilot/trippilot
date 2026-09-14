package com.trippilot.app

import com.fasterxml.jackson.databind.ObjectMapper
import com.trippilot.app.event.OutboxRelay
import com.trippilot.core.event.DomainEvent
import com.trippilot.core.event.DomainEventPublisher
import com.trippilot.core.event.EventEnvelope
import com.trippilot.core.event.OutboxSubscriber
import com.trippilot.testsupport.AbstractPostgresIntegrationTest
import io.kotest.assertions.withClue
import io.kotest.matchers.collections.shouldContain
import io.kotest.matchers.collections.shouldNotContain
import io.kotest.matchers.ints.shouldBeGreaterThan
import io.kotest.matchers.shouldBe
import io.kotest.matchers.string.shouldContain
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.boot.test.context.TestConfiguration
import org.springframework.context.annotation.Bean
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.transaction.PlatformTransactionManager
import org.springframework.transaction.support.TransactionTemplate

/**
 * 아웃박스 적재·릴레이 실 DB 검증(TRIP-539).
 *
 * 여기서만 드러나는 것 — 인메모리 대역으로는 **원리적으로** 못 본다:
 * - **트랜잭션 롤백 시 적재도 없다** — 트랜잭셔널 아웃박스의 전부다. 대역은 트랜잭션이 없다
 * - **`jsonb` 왕복** — payload 를 `?::jsonb` 로 넣고 문자열로 읽는다. 캐스팅이 어긋나면 저장부터 실패한다
 * - **`RETURNING attempts`** — 증가값을 한 번에 받는 문법이 실제로 도는지
 * - **부분 인덱스 대상 조회** — `published_at IS NULL` 로 좁히는 경로
 */
@SpringBootTest
class OutboxRelayIT : AbstractPostgresIntegrationTest() {

    /** 릴레이가 배달한 것을 기록하는 구독자 — 이 테스트에서만 컨텍스트에 올린다. */
    class Recording : OutboxSubscriber {
        override val eventType = "test.RelayProbe"
        val received = mutableListOf<EventEnvelope>()
        var failNext = false
        override fun handle(envelope: EventEnvelope) {
            if (failNext) { failNext = false; error("의도된 배달 실패") }
            received += envelope
        }
    }

    @TestConfiguration
    class Probes {
        @Bean fun recordingSubscriber() = Recording()
    }

    @Autowired private lateinit var publisher: DomainEventPublisher
    @Autowired private lateinit var relay: OutboxRelay
    @Autowired private lateinit var jdbc: JdbcTemplate
    @Autowired private lateinit var subscriber: Recording
    @Autowired private lateinit var txManager: PlatformTransactionManager

    private val tx by lazy { TransactionTemplate(txManager) }

    /** 어떤 구독자도 등록하지 않은 타입 — 릴레이가 이것을 어떻게 처리하는지 본다. */
    private data class Unheard(val note: String) : DomainEvent {
        override val eventType = "test.NobodyListens"
        override val aggregateType = "Probe"
        override val aggregateId = note
    }

    private data class Probe(val note: String) : DomainEvent {
        override val eventType = "test.RelayProbe"
        override val aggregateType = "Probe"
        override val aggregateId = note
    }

    @Autowired lateinit var registry: io.micrometer.core.instrument.MeterRegistry

    @AfterEach
    fun cleanUp() {
        // 싱글톤 컨테이너라 남기면 다른 IT 의 릴레이가 이 행을 집는다.
        jdbc.update("DELETE FROM outbox_event WHERE event_type IN ('test.RelayProbe', 'test.NobodyListens')")
        subscriber.received.clear()
        // 실패 플래그도 되돌린다 — 설정해 둔 이벤트가 (백오프 등으로) 안 집히면 그대로 남아
        // **다음 테스트의 첫 배달을 엉뚱하게 실패시킨다**. 백오프 도입으로 "안 집히는 경로"가 생겼다.
        subscriber.failNext = false
    }

    private fun unpublished(note: String) = jdbc.queryForObject(
        "SELECT count(*) FROM outbox_event WHERE aggregate_id = ? AND published_at IS NULL",
        Int::class.java, note,
    )!!

    @Test
    fun `발행하면 아웃박스에 적재되고 릴레이가 구독자에게 배달한다`() {
        tx.execute { publisher.publish(Probe("배달")) }

        unpublished("배달") shouldBe 1 // 아직 미발행
        // **한 번으로는 못 온다.** 릴레이는 오래된 것부터 배치 상한(100)만큼 집는데, 같은 컨테이너를
        // 쓰는 다른 IT 가 남긴 미발행 이벤트가 앞에 있으면 이 행은 그 배치에 안 들어간다.
        // 숙소 등록마다 이벤트가 나가기 시작하면서(TRIP-550) 실제로 이 형태로 깨졌다 —
        // 횟수를 늘리는 대신 **이 행이 발행될 때까지** 상한을 두고 돌린다.
        repeat(RELAY_TRIES) { if (unpublished("배달") > 0) relay.relay() }

        subscriber.received.map { it.aggregateId } shouldContain "배달"
        unpublished("배달") shouldBe 0 // 발행 표시됨
    }

    /**
     * **업무가 롤백되면 이벤트도 없다.** 이것이 트랜잭셔널 아웃박스를 쓰는 이유 전부다 —
     * 일어나지 않은 일을 알리면 사용자는 있지도 않은 것을 보러 간다.
     */
    @Test
    fun `트랜잭션이 롤백되면 적재도 사라진다`() {
        runCatching {
            tx.execute {
                publisher.publish(Probe("롤백"))
                error("업무 실패")
            }
        }

        jdbc.queryForObject(
            "SELECT count(*) FROM outbox_event WHERE aggregate_id = '롤백'", Int::class.java,
        )!! shouldBe 0
    }

    /** 배달이 실패하면 발행 표시를 하지 않는다 — 표시해 버리면 그 이벤트는 영영 사라진다. */
    @Test
    fun `배달 실패는 발행으로 표시하지 않고 시도 횟수를 올린다`() {
        tx.execute { publisher.publish(Probe("실패")) }
        subscriber.failNext = true

        relay.relay()

        unpublished("실패") shouldBe 1 // 아직 미발행 — 백오프가 지난 뒤 다시 집는다
        jdbc.queryForObject(
            "SELECT attempts FROM outbox_event WHERE aggregate_id = '실패'", Int::class.java,
        )!! shouldBeGreaterThan 0

        dueNow("실패") // 백오프를 앞당긴다 — 실제로 기다리면 테스트가 그만큼 느려진다
        relay.relay() // 재시도하면 이번엔 간다
        subscriber.received.map { it.aggregateId } shouldContain "실패"
        unpublished("실패") shouldBe 0
    }

    /**
     * **백오프가 실제로 막는가**(REL-U6-01). 이게 없으면 죽어 있는 상대를 2초마다 10번 때리고
     * 20초 만에 포기한다 — 재시도가 이름만 남고, 상대에게는 짧은 스파이크로 보인다.
     */
    @Test
    fun `실패한 이벤트는 백오프가 지나기 전에는 다시 집히지 않는다`() {
        tx.execute { publisher.publish(Probe("백오프")) }
        subscriber.failNext = true
        relay.relay()
        subscriber.received.clear()

        relay.relay() // 곧바로 한 번 더 — 백오프 때문에 배치에 안 들어와야 한다

        subscriber.received.map { it.aggregateId } shouldNotContain "백오프"
        jdbc.queryForObject(
            "SELECT attempts FROM outbox_event WHERE aggregate_id = '백오프'", Int::class.java,
        )!! shouldBe 1 // 두 번째 relay 가 건드리지 못했다는 증거
    }

    /**
     * 재시도가 거듭될수록 간격이 **배로** 벌어진다(2·4·8초). 상수 지연이면 "백오프"가 아니다.
     *
     * 서로 비교(`delays[1] > delays[0]`)로 쓰면 안 된다 — 측정이 `next_attempt_at - now()` 라
     * 재는 시점의 흔들림만으로 순서가 뒤바뀌어, **상수 지연에서도 우연히 통과한다**(역검증에서 실측).
     * 그래서 회차별 절대 범위로 못박는다.
     */
    @Test
    fun `재시도 간격은 시도 횟수에 따라 배로 넓어진다`() {
        tx.execute { publisher.publish(Probe("간격")) }

        val delays = (1..3).map {
            subscriber.failNext = true
            dueNow("간격")
            relay.relay()
            jdbc.queryForObject(
                "SELECT EXTRACT(EPOCH FROM (next_attempt_at - now())) FROM outbox_event WHERE aggregate_id = '간격'",
                Double::class.java,
            )!!
        }

        // 기대 2·4·8초. 폭을 ±1초 두는 것은 측정 시점 흔들림 때문이고, 배수 구분은 이 폭에서도 유지된다.
        withClue("재시도 지연(초)=$delays") {
            (delays[0] in 1.0..3.0) shouldBe true
            (delays[1] in 3.0..5.0) shouldBe true
            (delays[2] in 7.0..9.0) shouldBe true
        }
    }

    /**
     * 상한(10회)에 닿은 행은 **조회로 찾아진다**(REL-U6-02 — dead-letter 테이블을 신설하지 않는다).
     * 백오프 컬럼이 그 성질을 가리면 포기한 이벤트가 영영 안 보인다.
     */
    @Test
    fun `포기한 이벤트는 미발행으로 남아 조회된다`() {
        tx.execute { publisher.publish(Probe("포기")) }
        jdbc.update("UPDATE outbox_event SET attempts = 10 WHERE aggregate_id = '포기'")

        relay.relay()

        jdbc.queryForObject(
            "SELECT count(*) FROM outbox_event WHERE published_at IS NULL AND attempts >= 10 AND aggregate_id = '포기'",
            Int::class.java,
        )!! shouldBe 1
    }

    /**
     * **릴레이 지연 계측이 배선돼 있는가**(OBS-U6-01). 이 지표가 PERF-U6-01 목표 대조의 유일한 근거다 —
     * 계측을 지워도 기능은 멀쩡히 돌기 때문에 여기서 잠그지 않으면 조용히 0 으로 남는다.
     */
    @Test
    fun `배달에 성공하면 적재부터 배달까지의 지연이 기록된다`() {
        val before = registry.find("trippilot.outbox.relay.latency").timer()?.count() ?: 0L
        tx.execute { publisher.publish(Probe("지연")) }

        // **내 이벤트가 배달될 때까지** 돌린다. 한 번만 부르면 같은 컨테이너를 쓰는 다른 IT 의 릴레이가
        // 그 사이 내 행을 집어가 이쪽 호출은 빈 배치를 보고, 타이머는 저쪽에서 오른다(실측으로 겪었다).
        repeat(RELAY_TRIES) { if (unpublished("지연") > 0) relay.relay() }
        unpublished("지연") shouldBe 0

        // 증가분을 정확히 1 로 못박지 않는다 — 같은 레지스트리를 공유하므로 다른 IT 의 배달도 함께
        // 센다. 여기서 봐야 하는 것은 "배달이 타이머를 올리는가"이지 그 절대 수가 아니다.
        val after = registry.find("trippilot.outbox.relay.latency").timer()!!.count()
        (after > before) shouldBe true
    }

    /** 백오프를 앞당겨 "시간이 지났다"를 만든다 — 실 시간을 기다리지 않기 위해. */
    private fun dueNow(note: String) =
        jdbc.update("UPDATE outbox_event SET next_attempt_at = now() - interval '1 second' WHERE aggregate_id = ?", note)

    /** 두 번 돌려도 구독자가 두 번 받지 않는다 — 발행 표시가 실제로 걸렸다는 증거. */
    @Test
    fun `발행된 이벤트를 다시 집지 않는다`() {
        tx.execute { publisher.publish(Probe("한번")) }

        relay.relay()
        relay.relay()

        subscriber.received.count { it.aggregateId == "한번" } shouldBe 1
    }

    /**
     * payload 가 jsonb 를 왕복한다 — 캐스팅이 어긋나면 저장부터 실패한다.
     *
     * ⚠ **바이트가 보존되지 않는다.** `jsonb` 는 저장하며 정규화한다 — 키 순서가 바뀌고 공백이
     * 재배치된다(실측: `{"note": "본문", ...}`). 그래서 문자열 비교가 아니라 **파싱해서** 본다.
     * payload 를 서명·해시하는 소비자가 생기면 이 성질이 문제가 된다 — 그때는 `json` 타입을 쓰거나
     * 원문을 따로 보관해야 한다.
     */
    @Test
    fun `payload 가 jsonb 를 왕복하며 값이 보존된다`() {
        tx.execute { publisher.publish(Probe("본문")) }

        relay.relay()

        val payload = subscriber.received.single { it.aggregateId == "본문" }.payload
        ObjectMapper().readTree(payload)["note"].asText() shouldBe "본문"
    }
    /**
     * **아무도 안 듣는 이벤트도 닫는다**(TRIP-539 자가 검수).
     *
     * 남겨 두면 두 가지가 터진다 — 미발행 행이 무한히 쌓여 배치가 그것으로 채워지고,
     * **나중에 구독자가 생겼을 때 쌓인 과거가 한꺼번에 배달된다.** 알림이라면 오래된 푸시 폭탄이다.
     *
     * 프로덕션에는 아직 `OutboxSubscriber` 가 **하나도 없다** — 즉 지금 이 경로가 전부다.
     */
    @Test
    fun `구독자가 없는 이벤트는 쌓이지 않고 닫힌다`() {
        tx.execute { publisher.publish(Unheard("주인없음")) }

        relay.relay()

        jdbc.queryForObject(
            "SELECT count(*) FROM outbox_event WHERE aggregate_id = '주인없음' AND published_at IS NULL",
            Int::class.java,
        )!! shouldBe 0
        subscriber.received.map { it.aggregateId } shouldNotContain "주인없음"
    }


    private companion object {
        /** 앞에 쌓인 미발행분을 넘어가기 위한 상한. 배치 100 × 이 횟수면 충분하고, 무한 루프도 아니다. */
        private const val RELAY_TRIES = 20
    }

}
