package com.trippilot.app

import com.trippilot.app.event.SpringDomainEventPublisher
import com.trippilot.core.event.DomainEvent
import io.mockk.mockk
import io.mockk.verify
import org.junit.jupiter.api.Test
import org.springframework.context.ApplicationEventPublisher

class SpringDomainEventPublisherTest {

    @Test
    fun `publish 는 ApplicationEventPublisher 로 위임한다`() {
        val delegate = mockk<ApplicationEventPublisher>(relaxed = true)
        val publisher = SpringDomainEventPublisher(delegate)
        val event = object : DomainEvent {
            override val eventType = "test.Thing"
            override val aggregateType = "Thing"
            override val aggregateId = "1"
        }

        publisher.publish(event)

        verify { delegate.publishEvent(event) }
    }
}
