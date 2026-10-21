package com.trippilot.notification.adapter.`in`.event

import com.fasterxml.jackson.databind.ObjectMapper
import com.trippilot.core.event.EventEnvelope
import com.trippilot.notification.application.FakeNotifications
import com.trippilot.notification.application.FakeToggles
import com.trippilot.notification.application.FakeTripOwner
import com.trippilot.notification.application.NotificationRaiseService
import com.trippilot.notification.application.NotificationToggleService
import com.trippilot.notification.application.noPush
import com.trippilot.notification.application.testMetrics
import io.kotest.assertions.throwables.shouldThrow
import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.collections.shouldBeEmpty
import io.kotest.matchers.shouldBe
import java.time.Clock
import java.time.Instant
import java.time.ZoneOffset
import java.util.UUID

/**
 * 매번 같은 이유로 실패하는 payload(TRIP-1476 A·D). 릴레이는 같은 입력을 상한까지 다시 배달하므로,
 * 여기서 생기는 예외는 재시도로 풀리지 않는다.
 * - 숙소 이름이 비었거나 공백뿐이면 이름이 없는 것과 같다 — 기본 본문으로 적재한다(종전: 본문 검증에 걸려 알림 유실).
 * - 회고 사건의 tripId 가 UUID 가 아니면 eventId 를 담아 예외로 올린다(종전: eventId 없는 `Invalid UUID string`).
 */
class DomainNotificationPoisonPayloadTest : StringSpec({

    val mapper = ObjectMapper()
    val clock = Clock.fixed(Instant.parse("2026-08-10T00:00:00Z"), ZoneOffset.UTC)

    fun raiseService(stored: FakeNotifications): NotificationRaiseService {
        val toggles = NotificationToggleService(FakeToggles(), clock)
        return NotificationRaiseService(stored, toggles, noPush(clock, stored, toggles), FakeTripOwner(), testMetrics(stored), clock)
    }

    fun envelope(payload: String, type: String) = EventEnvelope(
        eventId = UUID.randomUUID(), eventType = type, schemaVersion = 1,
        aggregateType = "X", aggregateId = UUID.randomUUID().toString(), correlationId = null,
        occurredAt = Instant.EPOCH, payload = payload,
    )

    "숙소 이름이 빈 문자열이거나 공백뿐이면 본문은 '숙소' 다 — 본문 검증에 걸려 알림이 유실되지 않는다" {
        listOf("", "   ", "\t\n").forEach { name ->
            val stored = FakeNotifications()
            val acc = UUID.randomUUID()
            val payload = mapper.writeValueAsString(mapOf("accountId" to acc.toString(), "name" to name))
            StayRegisteredSubscriber(raiseService(stored), mapper).handle(envelope(payload, "stay.StayRegistered"))
            val n = stored.stored.single()
            n.accountId shouldBe acc
            n.body shouldBe "숙소"
        }
    }

    // 메시지를 둘로 가른 것을 지킨다 — "tripId 가 없음"과 "있는데 UUID 가 아님"은 운영에서 원인이 다르다.
    // `""` 는 있는데 빈 값(있는 쪽), 키가 아예 없으면 없는 쪽이다.
    "회고 사건의 tripId 가 UUID 가 아니면 eventId 를 담아 예외다 — 적재하지 않는다" {
        listOf("nope", "", "123").forEach { tripId ->
            val stored = FakeNotifications()
            val e = envelope(mapper.writeValueAsString(mapOf("tripId" to tripId, "kind" to "SUMMARY")), "reflection.ReflectionReady")
            shouldThrow<IllegalStateException> { ReflectionReadySubscriber(raiseService(stored), mapper).handle(e) }
                .message shouldBe "ReflectionReady 의 tripId 가 UUID 가 아닙니다. tripId=$tripId eventId=${e.eventId}"
            stored.stored.shouldBeEmpty()
        }
    }

    "회고 사건에 tripId 가 아예 없으면 '읽지 못했습니다' 쪽 예외다" {
        val stored = FakeNotifications()
        val e = envelope(mapper.writeValueAsString(mapOf("kind" to "SUMMARY")), "reflection.ReflectionReady")
        shouldThrow<IllegalStateException> { ReflectionReadySubscriber(raiseService(stored), mapper).handle(e) }
            .message shouldBe "ReflectionReady payload 에서 tripId 를 읽지 못했습니다. eventId=${e.eventId}"
        stored.stored.shouldBeEmpty()
    }
})
