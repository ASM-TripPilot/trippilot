package com.trippilot.app

import com.fasterxml.jackson.databind.ObjectMapper
import com.trippilot.app.event.OutboxRelay
import com.trippilot.core.event.DomainEvent
import com.trippilot.core.event.DomainEventPublisher
import com.trippilot.core.event.EventEnvelope
import com.trippilot.core.event.OutboxSubscriber
import com.trippilot.testsupport.AbstractPostgresIntegrationTest
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

    @AfterEach
    fun cleanUp() {
        // 싱글톤 컨테이너라 남기면 다른 IT 의 릴레이가 이 행을 집는다.
        jdbc.update("DELETE FROM outbox_event WHERE event_type IN ('test.RelayProbe', 'test.NobodyListens')")
        subscriber.received.clear()
    }

    private fun unpublished(note: String) = jdbc.queryForObject(
        "SELECT count(*) FROM outbox_event WHERE aggregate_id = ? AND published_at IS NULL",
        Int::class.java, note,
    )!!

    @Test
    fun `발행하면 아웃박스에 적재되고 릴레이가 구독자에게 배달한다`() {
        tx.execute { publisher.publish(Probe("배달")) }

        unpublished("배달") shouldBe 1 // 아직 미발행
        relay.relay()

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

        unpublished("실패") shouldBe 1 // 아직 미발행 — 다음 폴링이 다시 집는다
        jdbc.queryForObject(
            "SELECT attempts FROM outbox_event WHERE aggregate_id = '실패'", Int::class.java,
        )!! shouldBeGreaterThan 0

        relay.relay() // 재시도하면 이번엔 간다
        subscriber.received.map { it.aggregateId } shouldContain "실패"
        unpublished("실패") shouldBe 0
    }

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

}
