package com.trippilot.notification.application

import com.trippilot.notification.domain.DevicePlatform
import com.trippilot.notification.domain.NotificationKind
import com.trippilot.notification.domain.NotificationToggle
import com.trippilot.notification.domain.OsPermission
import com.trippilot.notification.domain.PushMessage
import com.trippilot.notification.domain.PushPort
import com.trippilot.notification.domain.PushReceipt
import com.trippilot.notification.domain.PushStatus
import com.trippilot.notification.domain.PushToken
import com.trippilot.notification.domain.PushTokenRepository
import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.shouldBe
import io.kotest.matchers.shouldNotBe
import io.kotest.property.Arb
import io.kotest.property.arbitrary.bind
import io.kotest.property.arbitrary.boolean
import io.kotest.property.arbitrary.choice
import io.kotest.property.arbitrary.int
import io.kotest.property.arbitrary.list
import io.kotest.property.arbitrary.long
import io.kotest.property.arbitrary.of
import io.kotest.property.checkAll
import io.micrometer.core.instrument.simple.SimpleMeterRegistry
import java.time.Clock
import java.time.Duration
import java.time.Instant
import java.time.ZoneId
import java.time.ZoneOffset
import java.util.UUID

/**
 * 적재 뒤 푸시 정책(BR-SA-21 ② · PBT-SA-18).
 *
 * 조용히 틀릴 수 있는 것이 셋이다 — 알림함만 사건이 기기를 울린다(주의가 위험처럼 푸시된다),
 * 같은 여행의 위험이 몇 분 간격으로 연달아 울린다, 그리고 반대로 **묶일 이유가 없는데 묶인다**
 * (위험 알림이 사용자에게 닿지 않는다). 셋 다 알림함 행은 멀쩡해서 조회로는 드러나지 않는다.
 */
class PushPolicyTest : StringSpec({

    val acc = UUID.randomUUID()
    val start = Instant.parse("2026-10-19T00:15:00Z")
    val window = Duration.ofMinutes(10)

    class MovingClock(var now: Instant) : Clock() {
        override fun getZone(): ZoneId = ZoneOffset.UTC
        override fun withZone(zone: ZoneId?): Clock = this
        override fun instant(): Instant = now
    }

    /** 계정마다 쏠 수 있는 기기 하나 — 정책 말고 다른 이유(기기 없음)로 푸시가 막히지 않게 한다. */
    class OneDevice : PushTokenRepository {
        override fun register(token: PushToken) = token
        override fun findActive(accountId: UUID) = listOf(
            PushToken(
                UUID.randomUUID(), accountId, "ExponentPushToken[policy]", null,
                DevicePlatform.ANDROID, OsPermission.GRANTED, Instant.EPOCH, null,
            ),
        )
        override fun invalidate(token: String, at: Instant) = false
        override fun remove(accountId: UUID, token: String) = false
    }

    class CountingSender : PushPort {
        override val deliversExternally = true
        var calls = 0
        override fun send(tokens: List<String>, message: PushMessage): List<PushReceipt> {
            calls++
            return tokens.map { PushReceipt(it, PushStatus.SENT) }
        }
    }

    class Fixture(
        val clock: MovingClock,
        val notifications: FakeNotifications,
        val sender: CountingSender,
        val registry: SimpleMeterRegistry,
        val service: NotificationRaiseService,
    ) {
        fun suppressed(reason: String) = registry.counter(NotificationMetrics.SUPPRESSED, "reason", reason).count()

        /** 발송 경로에 닿은 횟수(결말 무관). 알림함만·묶음은 여기 나타나면 안 된다 — 억제 총량 식이 이중으로 센다. */
        fun dispatched() = registry.find(NotificationMetrics.PUSH_DISPATCH).counters().sumOf { it.count() }
    }

    fun fixture(): Fixture {
        val clock = MovingClock(start)
        val notifications = FakeNotifications()
        // 기본값과 무관하게 정책만 잰다 — 토글이 막으면 무엇이 푸시를 막았는지 갈리지 않는다.
        val toggles = FakeToggles().apply {
            upsert(NotificationToggle(acc, NotificationKind.PLAN_B, pushEnabled = true, inAppEnabled = true, updatedAt = start))
        }
        val toggleService = NotificationToggleService(toggles, clock)
        val registry = SimpleMeterRegistry()
        val metrics = NotificationMetrics(registry, notifications)
        val sender = CountingSender()
        // 계정 발송량 상한이 정책 대신 푸시를 막지 않게 넉넉히 둔다 — 여기서 재는 것은 정책뿐이다.
        val dispatch = PushDispatchService(
            OneDevice(), notifications, toggleService, sender, metrics, PushRateLimits(hourly = 1_000, daily = 1_000), clock,
        )
        val service = NotificationRaiseService(notifications, toggleService, dispatch, FakeTripOwner(), metrics, clock)
        return Fixture(clock, notifications, sender, registry, service)
    }

    fun Fixture.raise(tripId: UUID, push: PushPolicy, eventId: UUID = UUID.randomUUID()) = service.raise(
        accountId = acc,
        kind = NotificationKind.PLAN_B,
        title = "날씨가 일정에 영향을 줄 수 있어요",
        body = "오후에 비 소식이 있어요.",
        sourceEventId = eventId,
        dedupKey = "PLAN_B#$tripId#2026-10-19#${UUID.randomUUID()}",
        push = push,
    )

    fun oncePer(tripId: UUID) = PushPolicy.OncePer("PLAN_B#$tripId#", window)

    "알림함만 사건은 적재되고 푸시는 시도하지 않는다 — 발송 시각도 남지 않는다" {
        val f = fixture()

        f.raise(UUID.randomUUID(), PushPolicy.InAppOnly)

        f.notifications.stored.size shouldBe 1
        f.notifications.stored.single().pushSentAt shouldBe null
        f.sender.calls shouldBe 0
        f.suppressed("IN_APP_ONLY") shouldBe 1.0
        f.dispatched() shouldBe 0.0
    }

    "같은 여행의 두 번째 위험은 10분 안이면 푸시가 묶인다 — 알림함에는 둘 다 있다" {
        val f = fixture()
        val trip = UUID.randomUUID()

        f.raise(trip, oncePer(trip))
        f.clock.now = start.plus(Duration.ofMinutes(10)).minusSeconds(1)
        f.raise(trip, oncePer(trip))

        f.notifications.stored.size shouldBe 2
        f.notifications.stored[0].pushSentAt shouldBe start
        f.notifications.stored[1].pushSentAt shouldBe null
        f.sender.calls shouldBe 1
        f.suppressed("COALESCED") shouldBe 1.0
        // 묶음은 발송 경로 앞에서 끝난다 — dispatch 지표에 나타나면 억제 총량 식이 그 사유를 두 번 센다.
        f.dispatched() shouldBe 1.0
    }

    "10분이 지나면 다시 푸시한다 — 묶음이 같은 여행을 영영 막지 않는다" {
        val f = fixture()
        val trip = UUID.randomUUID()

        f.raise(trip, oncePer(trip))
        f.clock.now = start.plus(Duration.ofMinutes(10))
        f.raise(trip, oncePer(trip))

        f.sender.calls shouldBe 2
        f.notifications.stored[1].pushSentAt shouldBe start.plus(Duration.ofMinutes(10))
        f.suppressed("COALESCED") shouldBe 0.0
    }

    "다른 여행은 묶이지 않는다 — 접두가 다르면 각자 나간다" {
        val f = fixture()
        val tripA = UUID.randomUUID()
        val tripB = UUID.randomUUID()

        f.raise(tripA, oncePer(tripA))
        f.clock.now = start.plusSeconds(60)
        f.raise(tripB, oncePer(tripB))

        f.sender.calls shouldBe 2
    }

    "실제로 나가지 않은 알림은 묶음의 근거가 아니다 — 알림함만 사건 뒤의 위험은 바로 나간다" {
        val f = fixture()
        val trip = UUID.randomUUID()

        f.raise(trip, PushPolicy.InAppOnly)
        f.clock.now = start.plusSeconds(60)
        f.raise(trip, oncePer(trip))

        f.sender.calls shouldBe 1
        f.notifications.stored[1].pushSentAt shouldNotBe null
    }

    "재배달은 정책 판정 전에 끝난다 — 묶음·알림함만 지표를 두 번 세지 않는다" {
        val f = fixture()
        val trip = UUID.randomUUID()
        val pushed = UUID.randomUUID()
        val quiet = UUID.randomUUID()

        f.raise(trip, oncePer(trip), eventId = pushed)
        f.raise(trip, oncePer(trip), eventId = pushed) // 같은 사건 재배달 — 10분 안이지만 묶음이 아니라 중복이다
        f.raise(trip, PushPolicy.InAppOnly, eventId = quiet)
        f.raise(trip, PushPolicy.InAppOnly, eventId = quiet)

        f.notifications.stored.size shouldBe 2
        f.sender.calls shouldBe 1
        f.suppressed("DUPLICATE") shouldBe 2.0
        f.suppressed("COALESCED") shouldBe 0.0
        f.suppressed("IN_APP_ONLY") shouldBe 1.0
    }

    "정책을 주지 않으면 종전대로 매번 푸시한다 — 숙소·회고 구독자 동작 불변" {
        val f = fixture()

        repeat(2) {
            f.service.raise(
                accountId = acc, kind = NotificationKind.STAY, title = "숙소가 등록됐어요", body = "제주 호텔",
                sourceEventId = UUID.randomUUID(), dedupKey = "STAY#same",
            )
        }

        f.sender.calls shouldBe 2
    }

    /**
     * **성질(PBT-SA-18)** — 임의의 사건 열(여행 3개 × 알림함만/푸시 대상 × 0~15분 간격, 10분 경계 근처 가중)에서
     * ① 알림함 행 누락 0 ② 같은 여행 푸시 간격 ≥ 10분 ③ 알림함만 행은 발송 시각이 없다
     * ④ 과잉 억제 없음 — 푸시 대상인데 안 나간 행에는 10분 안에 실제로 나간 같은 여행 푸시가 있다.
     *
     * 사건 수 상한 30 은 묶음 판정이 보는 최근 알림 50건 안이다 — 10분 안에 한 계정 알림이 50건을 넘는
     * 경우는 이 판정의 전제 밖이다(포트·SQL 을 늘리지 않는 대가, 감지는 여행·회차당 사건 1건 — INV-SA-3).
     */
    "같은 여행 푸시는 10분에 한 번 — 알림함은 빠짐없고, 묶일 이유 없이 묶이지 않는다" {
        data class Step(val trip: Int, val inAppOnly: Boolean, val gapSeconds: Long)

        val trips = List(3) { UUID.randomUUID() }
        val gap = Arb.choice(Arb.long(0L..900L), Arb.of(599L, 600L, 601L))
        val steps = Arb.list(Arb.bind(Arb.int(0..2), Arb.boolean(), gap) { t, q, g -> Step(t, q, g) }, 1..30)

        checkAll(steps) { seq ->
            val f = fixture()
            val raisedAt = seq.map { s ->
                f.clock.now = f.clock.now.plusSeconds(s.gapSeconds)
                f.raise(trips[s.trip], if (s.inAppOnly) PushPolicy.InAppOnly else oncePer(trips[s.trip]))
                f.clock.now
            }
            val rows = f.notifications.stored

            rows.size shouldBe seq.size // ①
            seq.indices.filter { seq[it].inAppOnly }.forEach { rows[it].pushSentAt shouldBe null } // ③
            trips.indices.forEach { t ->
                val pushed = seq.indices.filter { seq[it].trip == t }.mapNotNull { rows[it].pushSentAt }.sorted()
                pushed.zipWithNext().forEach { (a, b) -> (Duration.between(a, b) >= window) shouldBe true } // ②
            }
            seq.indices.filter { !seq[it].inAppOnly && rows[it].pushSentAt == null }.forEach { i ->
                val at = raisedAt[i]
                val justified = seq.indices.any { j ->
                    seq[j].trip == seq[i].trip && rows[j].pushSentAt?.let { it > at.minus(window) && it <= at } == true
                }
                justified shouldBe true // ④
            }
        }
    }
})
