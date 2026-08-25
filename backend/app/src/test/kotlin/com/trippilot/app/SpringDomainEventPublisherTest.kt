package com.trippilot.app

import com.fasterxml.jackson.databind.ObjectMapper
import com.trippilot.app.event.SpringDomainEventPublisher
import com.trippilot.core.event.DomainEvent
import com.trippilot.core.event.EventEnvelope
import com.trippilot.core.event.OutboxStore
import io.kotest.matchers.shouldBe
import io.kotest.matchers.string.shouldContain
import io.mockk.mockk
import io.mockk.verify
import org.junit.jupiter.api.Test
import org.springframework.context.ApplicationEventPublisher
import java.time.Clock
import java.time.Instant
import java.time.ZoneOffset

/**
 * 발행은 **두 곳으로 간다**(TRIP-539) — 인프로세스 구독자와 아웃박스.
 *
 * 인프로세스만 있던 시절에는 "업무는 저장됐는데 이벤트는 사라진" 구간이 있었다(발행 직후 프로세스
 * 종료). 아웃박스 적재가 그 구간을 없앤다 — 여기서 **둘 다 일어나는지**를 못 박는다.
 */
class SpringDomainEventPublisherTest {

    private val now = Instant.parse("2026-08-25T00:00:00Z")

    private class Recording : OutboxStore {
        val appended = mutableListOf<EventEnvelope>()
        override fun append(envelope: EventEnvelope) { appended += envelope }
    }

    private data class ThingHappened(val thingId: String, val amount: Int) : DomainEvent {
        override val eventType = "test.ThingHappened"
        override val aggregateType = "Thing"
        override val aggregateId = thingId
    }

    private fun publisherWith(outbox: OutboxStore, delegate: ApplicationEventPublisher) =
        SpringDomainEventPublisher(delegate, outbox, ObjectMapper(), Clock.fixed(now, ZoneOffset.UTC))

    @Test
    fun `기존 인프로세스 구독자에게 그대로 간다`() {
        val delegate = mockk<ApplicationEventPublisher>(relaxed = true)
        val event = ThingHappened("1", 7)

        publisherWith(Recording(), delegate).publish(event)

        verify { delegate.publishEvent(event) }
    }

    /** 이 적재가 없으면 릴레이가 배달할 것이 없다 — at-least-once 의 출발점이다. */
    @Test
    fun `같은 발행이 아웃박스에도 적재된다`() {
        val outbox = Recording()

        publisherWith(outbox, mockk(relaxed = true)).publish(ThingHappened("42", 7))

        val envelope = outbox.appended.single()
        envelope.eventType shouldBe "test.ThingHappened"
        envelope.aggregateType shouldBe "Thing"
        envelope.aggregateId shouldBe "42"
        envelope.occurredAt shouldBe now
    }

    /**
     * **payload 에 이벤트 내용이 실려야 한다.** 타입만 싣고 본문을 빼면 구독자가 다시 조회해야 하고,
     * 그때는 이미 값이 바뀌어 있을 수 있다 — 이벤트가 "그 시점의 사실"이라는 성질이 사라진다.
     */
    @Test
    fun `payload 에 이벤트 본문이 직렬화된다`() {
        val outbox = Recording()

        publisherWith(outbox, mockk(relaxed = true)).publish(ThingHappened("42", 7))

        outbox.appended.single().payload.let {
            it shouldContain "\"thingId\":\"42\""
            it shouldContain "\"amount\":7"
        }
    }

    /** 봉투마다 다른 id — 구독자가 이 값으로 중복을 거른다(멱등 키). */
    @Test
    fun `발행마다 새 이벤트 id 를 받는다`() {
        val outbox = Recording()
        val publisher = publisherWith(outbox, mockk(relaxed = true))

        publisher.publish(ThingHappened("1", 1))
        publisher.publish(ThingHappened("1", 1))

        outbox.appended.map { it.eventId }.toSet().size shouldBe 2
    }
}
