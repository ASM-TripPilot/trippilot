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
import com.trippilot.notification.domain.NotificationKind
import io.kotest.assertions.throwables.shouldThrow
import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.collections.shouldBeEmpty
import io.kotest.matchers.shouldBe
import io.kotest.matchers.string.shouldContain
import java.time.Clock
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneOffset
import java.util.UUID

/**
 * 도메인 사건 payload 를 못 읽을 때 — **예외로 올린다**(INV-4).
 *
 * 릴레이가 재시도하고 상한에서 error 로 남긴다. 조용히 건너뛰면 "알림이 왜 안 오나"를 영영 못 찾는다.
 * 반대로 선택 필드(숙소 이름)가 빠진 것은 실패가 아니다 — 기본값으로 적재한다.
 * 정상 payload 의 관통은 app `DomainNotificationIT` 가 본다. 적재는 실제 [NotificationRaiseService] 와
 * 인메모리 대역으로 한다 — 알림 생성 불변식(제목·본문 상한)까지 같이 지난다.
 *
 * 실패 케이스마다 "적재 0건"도 본다. 지금은 구독자가 raise 전에 던지므로 늘 0 이지만, 검사를 raise 뒤로 옮기는
 * 회귀(적재하고 나서 던짐 → 재시도마다 중복 적재, 엉뚱한 계정 적재)는 예외 단정만으로는 안 보인다.
 */
class DomainNotificationPayloadTest : StringSpec({

    val mapper = ObjectMapper()
    val clock = Clock.fixed(Instant.parse("2026-08-10T00:00:00Z"), ZoneOffset.UTC)

    class Fixture(val stored: FakeNotifications, val trips: FakeTripOwner, val raise: NotificationRaiseService)

    fun fixture(): Fixture {
        val notifications = FakeNotifications()
        val toggles = NotificationToggleService(FakeToggles(), clock)
        val trips = FakeTripOwner()
        val metrics = testMetrics(notifications)
        return Fixture(notifications, trips, NotificationRaiseService(notifications, toggles, noPush(clock, notifications, toggles), trips, metrics, clock))
    }

    fun envelope(payload: String, type: String) = EventEnvelope(
        eventId = UUID.randomUUID(), eventType = type, schemaVersion = 1,
        aggregateType = "X", aggregateId = UUID.randomUUID().toString(), correlationId = null,
        occurredAt = Instant.EPOCH, payload = payload,
    )

    fun json(vararg pairs: Pair<String, Any?>) = mapper.writeValueAsString(mapOf(*pairs))

    "JSON 이 아닌 payload 는 eventId 를 담아 예외로 올린다 — 적재하지 않는다" {
        val f = fixture()
        val e = envelope("{not json", "stay.StayRegistered")
        val message = shouldThrow<IllegalStateException> { StayRegisteredSubscriber(f.raise, mapper).handle(e) }.message
        message shouldContain e.eventId.toString()
        message shouldContain "payload 를 읽지 못했습니다" // 파싱 실패로 보고된다 — 빈 트리로 삼켜 "accountId 없음"이 되면 안 된다
        f.stored.stored.shouldBeEmpty()
    }

    "숙소 사건에 accountId 가 없거나 null 이거나 UUID 가 아니면 예외다" {
        val f = fixture()
        listOf(json("name" to "호텔"), json("accountId" to null), json("accountId" to "nope")).forEach { p ->
            shouldThrow<IllegalStateException> { StayRegisteredSubscriber(f.raise, mapper).handle(envelope(p, "stay.StayRegistered")) }
                .message shouldContain "accountId"
            f.stored.stored.shouldBeEmpty()
        }
    }

    // 이름 키가 **없는** 경우만이다. 빈 문자열("")은 `?: "숙소"` 를 타지 않아 본문이 비고 적재가 실패한다 — TRIP-1476(A).
    "숙소 이름 키가 없으면 본문은 '숙소' 다 — 빈 본문으로 실패시키지 않는다" {
        val f = fixture()
        val acc = UUID.randomUUID()
        StayRegisteredSubscriber(f.raise, mapper).handle(envelope(json("accountId" to acc.toString()), "stay.StayRegistered"))
        val n = f.stored.stored.single()
        n.accountId shouldBe acc
        n.kind shouldBe NotificationKind.STAY
        (n.title to n.body) shouldBe ("숙소가 등록됐어요" to "숙소")
    }

    "Plan-B 사건에 accountId 가 없거나 null 이거나 UUID 가 아니면 예외다" {
        val f = fixture()
        val trip = UUID.randomUUID().toString()
        listOf(json("tripId" to trip), json("tripId" to trip, "accountId" to null), json("tripId" to trip, "accountId" to "nope")).forEach { p ->
            shouldThrow<IllegalStateException> { PlanBTriggeredSubscriber(f.raise, mapper).handle(envelope(p, "planb.PlanBTriggered")) }
                .message shouldContain "accountId"
            f.stored.stored.shouldBeEmpty()
        }
    }

    "회고 사건에 tripId 가 없으면 예외다" {
        val f = fixture()
        shouldThrow<IllegalStateException> {
            ReflectionReadySubscriber(f.raise, mapper).handle(envelope(json("kind" to "SUMMARY"), "reflection.ReflectionReady"))
        }.message shouldContain "tripId"
        f.stored.stored.shouldBeEmpty()
    }

    "여행 소유자를 못 찾으면 예외다 — 엉뚱한 계정에 적재하지 않는다" {
        val f = fixture()
        shouldThrow<IllegalStateException> {
            ReflectionReadySubscriber(f.raise, mapper).handle(
                envelope(json("tripId" to UUID.randomUUID().toString(), "kind" to "SUMMARY"), "reflection.ReflectionReady"),
            )
        }.message shouldContain "소유자"
        f.stored.stored.shouldBeEmpty()
    }

    "하루 회고에 dayDate 가 없으면 예외다 — 어느 날 회고인지 모르는 알림을 만들지 않는다" {
        val f = fixture()
        val trip = UUID.randomUUID()
        f.trips.put(trip, UUID.randomUUID(), LocalDate.parse("2026-08-10"), LocalDate.parse("2026-08-12"))
        shouldThrow<IllegalStateException> {
            ReflectionReadySubscriber(f.raise, mapper).handle(envelope(json("tripId" to trip.toString(), "kind" to "DAILY"), "reflection.ReflectionReady"))
        }.message shouldContain "dayDate"
        f.stored.stored.shouldBeEmpty()
    }
})
