package com.trippilot.notification.adapter.`in`.event

import com.fasterxml.jackson.databind.ObjectMapper
import com.trippilot.core.event.EventEnvelope
import com.trippilot.notification.application.NotificationRaiseService
import com.trippilot.notification.domain.NotificationKind
import io.kotest.assertions.throwables.shouldThrow
import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.string.shouldContain
import io.mockk.every
import io.mockk.mockk
import io.mockk.verify
import java.time.Instant
import java.util.UUID

/**
 * 도메인 사건 payload 를 못 읽을 때 — **예외로 올린다**(INV-4).
 *
 * 릴레이가 재시도하고 상한에서 error 로 남긴다. 조용히 건너뛰면 "알림이 왜 안 오나"를 영영 못 찾는다.
 * 반대로 선택 필드(숙소 이름)가 빠진 것은 실패가 아니다 — 기본값으로 적재한다.
 * 정상 payload 의 관통은 app `DomainNotificationIT` 가 본다.
 */
class DomainNotificationPayloadTest : StringSpec({

    val mapper = ObjectMapper()

    fun envelope(payload: String, type: String) = EventEnvelope(
        eventId = UUID.randomUUID(), eventType = type, schemaVersion = 1,
        aggregateType = "X", aggregateId = UUID.randomUUID().toString(), correlationId = null,
        occurredAt = Instant.EPOCH, payload = payload,
    )

    fun json(vararg pairs: Pair<String, Any?>) = mapper.writeValueAsString(mapOf(*pairs))

    "JSON 이 아닌 payload 는 eventId 를 담아 예외로 올린다 — 적재하지 않는다" {
        val raise = mockk<NotificationRaiseService>(relaxed = true)
        val e = envelope("{not json", "stay.StayRegistered")
        shouldThrow<IllegalStateException> { StayRegisteredSubscriber(raise, mapper).handle(e) }.message shouldContain e.eventId.toString()
        verify(exactly = 0) { raise.raise(any(), any(), any(), any(), any(), any(), any(), any(), any()) }
    }

    "숙소 사건에 accountId 가 없거나 null 이거나 UUID 가 아니면 예외다" {
        val raise = mockk<NotificationRaiseService>(relaxed = true)
        listOf(json("name" to "호텔"), json("accountId" to null), json("accountId" to "nope")).forEach { p ->
            shouldThrow<IllegalStateException> { StayRegisteredSubscriber(raise, mapper).handle(envelope(p, "stay.StayRegistered")) }
                .message shouldContain "accountId"
        }
        verify(exactly = 0) { raise.raise(any(), any(), any(), any(), any(), any(), any(), any(), any()) }
    }

    "숙소 이름이 없으면 본문은 '숙소' 다 — 빈 본문으로 실패시키지 않는다" {
        val raise = mockk<NotificationRaiseService>(relaxed = true)
        val acc = UUID.randomUUID()
        StayRegisteredSubscriber(raise, mapper).handle(envelope(json("accountId" to acc.toString()), "stay.StayRegistered"))
        verify { raise.raise(acc, NotificationKind.STAY, "숙소가 등록됐어요", "숙소", any(), any(), any(), any(), any()) }
    }

    "Plan-B 사건에 accountId 가 없으면 예외다" {
        val raise = mockk<NotificationRaiseService>(relaxed = true)
        shouldThrow<IllegalStateException> {
            PlanBTriggeredSubscriber(raise, mapper).handle(envelope(json("tripId" to UUID.randomUUID().toString()), "planb.PlanBTriggered"))
        }.message shouldContain "accountId"
    }

    "회고 사건에 tripId 가 없으면 예외다" {
        val raise = mockk<NotificationRaiseService>(relaxed = true)
        shouldThrow<IllegalStateException> {
            ReflectionReadySubscriber(raise, mapper).handle(envelope(json("kind" to "SUMMARY"), "reflection.ReflectionReady"))
        }.message shouldContain "tripId"
    }

    "여행 소유자를 못 찾으면 예외다 — 엉뚱한 계정에 적재하지 않는다" {
        val raise = mockk<NotificationRaiseService>(relaxed = true)
        every { raise.ownerOfTrip(any()) } returns null
        shouldThrow<IllegalStateException> {
            ReflectionReadySubscriber(raise, mapper).handle(
                envelope(json("tripId" to UUID.randomUUID().toString(), "kind" to "SUMMARY"), "reflection.ReflectionReady"),
            )
        }.message shouldContain "소유자"
    }

    "하루 회고에 dayDate 가 없으면 예외다 — 어느 날 회고인지 모르는 알림을 만들지 않는다" {
        val raise = mockk<NotificationRaiseService>(relaxed = true)
        every { raise.ownerOfTrip(any()) } returns UUID.randomUUID()
        shouldThrow<IllegalStateException> {
            ReflectionReadySubscriber(raise, mapper).handle(
                envelope(json("tripId" to UUID.randomUUID().toString(), "kind" to "DAILY"), "reflection.ReflectionReady"),
            )
        }.message shouldContain "dayDate"
        verify(exactly = 0) { raise.raise(any(), any(), any(), any(), any(), any(), any(), any(), any()) }
    }
})
