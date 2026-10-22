package com.trippilot.notification.application

import com.trippilot.notification.domain.DevicePlatform
import com.trippilot.notification.domain.Notification
import com.trippilot.notification.domain.NotificationKind
import com.trippilot.notification.domain.NotificationRepository
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

        /** 기기마다 돌려줄 결말 — 실패한 발송이 묶음의 근거가 되는지 잴 때 바꾼다. */
        var status = PushStatus.SENT
        override fun send(tokens: List<String>, message: PushMessage): List<PushReceipt> {
            calls++
            return tokens.map { PushReceipt(it, status) }
        }
    }

    /**
     * 최근 알림을 읽다 터지는 저장소 — 어휘 밖 kind 행이 하나라도 섞인 계정이다(`NotificationKind.of` 는
     * fail-loud). 나머지는 대역 그대로라 적재·발송 기록은 [inner] 에 남는다.
     */
    class UnreadableRecent(private val inner: FakeNotifications) : NotificationRepository by inner {
        override fun findByAccount(accountId: UUID, unreadOnly: Boolean, limit: Int): List<Notification> =
            error("알 수 없는 알림 종류입니다: LEGACY_X")
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

    /**
     * 계정 발송량 상한은 기본으로 넉넉히 둔다 — 정책 대신 상한이 푸시를 막지 않게(여기서 재는 것은 정책이다).
     * 둘의 상호작용을 잴 때만 [limits] 를 좁힌다.
     */
    fun fixture(
        limits: PushRateLimits = PushRateLimits(hourly = 1_000, daily = 1_000),
        recent: (FakeNotifications) -> NotificationRepository = { it },
    ): Fixture {
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
        val dispatch = PushDispatchService(OneDevice(), notifications, toggleService, sender, metrics, limits, clock)
        val service = NotificationRaiseService(recent(notifications), toggleService, dispatch, FakeTripOwner(), metrics, clock)
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

    /**
     * **묶음 판정 전에 그 묶음을 잠근다**(Kafka 모드 TRIP-1469 — 같은 여행의 사건을 소비 스레드 여럿이 동시에 배달한다).
     * 잠금이 빠지거나 판정 **뒤로** 밀리면 두 스레드가 서로의 발송을 못 본 채 둘 다 쏜다 — 단일 스레드 대역에서는
     * 결과가 같아, 판정이 최근 알림을 읽는 순간 그 묶음이 이미 잠겨 있는지를 본다. 묶음이 없는 정책은 잠글 것이 없다.
     */
    "묶음 정책만 그 여행의 묶음을 잠근다 — 판정 전에, 알림함만·매번 푸시는 잠그지 않는다" {
        val trip = UUID.randomUUID()
        // 판정이 읽는 순간 잠금이 있었는지를 **기록한다** — 던지면 판정의 runCatching 이 삼켜 "묶지 않음"으로 지나간다.
        val lockedAtRead = mutableListOf<Boolean>()
        val f = fixture(recent = { inner ->
            object : NotificationRepository by inner {
                override fun findByAccount(accountId: UUID, unreadOnly: Boolean, limit: Int): List<Notification> {
                    lockedAtRead += (accountId to "PLAN_B#$trip#") in inner.lockedGroups
                    return inner.findByAccount(accountId, unreadOnly, limit)
                }
            }
        })

        f.raise(UUID.randomUUID(), PushPolicy.InAppOnly)
        f.raise(UUID.randomUUID(), PushPolicy.Always)
        f.raise(trip, oncePer(trip))

        f.notifications.lockedGroups shouldBe listOf(acc to "PLAN_B#$trip#")
        lockedAtRead shouldBe listOf(true) // 판정은 묶음 정책에서 한 번, 잠금 뒤에 읽었다
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

    "전 기기에 실패한 발송은 묶음의 근거가 아니다 — 10분 안의 다음 위험은 다시 발송을 시도한다" {
        val f = fixture()
        val trip = UUID.randomUUID()

        f.sender.status = PushStatus.FAILED
        f.raise(trip, oncePer(trip))
        f.sender.status = PushStatus.SENT
        f.clock.now = start.plusSeconds(60)
        f.raise(trip, oncePer(trip))

        // 실패는 사유만 남고 발송 시각은 없다 — 그 행을 근거로 묶으면 위험이 한 번도 안 울린다.
        f.notifications.stored[0].pushSentAt shouldBe null
        // 사유가 없는 영수증은 상태 이름으로 남는다 — 빈 문자열이면 "왜 안 왔나"에 답이 없다.
        f.notifications.stored[0].pushFailedReason shouldBe "FAILED"
        f.sender.calls shouldBe 2
        f.notifications.stored[1].pushSentAt shouldBe start.plusSeconds(60)
        f.suppressed("COALESCED") shouldBe 0.0
    }

    "계정 상한과 10분 묶음은 서로의 근거가 아니다 — 묶인 건은 상한 자리를 쓰지 않고, 상한에 막힌 건은 묶음을 만들지 않는다" {
        val f = fixture(limits = PushRateLimits(hourly = 2, daily = 50))
        val trip = UUID.randomUUID()
        val other = UUID.randomUUID()
        val late = UUID.randomUUID()

        f.raise(trip, oncePer(trip)) // 나간다(시간 창 1/2)
        f.clock.now = start.plusSeconds(60)
        f.raise(trip, oncePer(trip)) // 묶인다 — 발송 시각이 없어 상한 자리를 쓰지 않는다
        f.clock.now = start.plusSeconds(120)
        f.raise(other, oncePer(other)) // 그래서 다른 여행이 나간다(2/2)
        f.clock.now = start.plusSeconds(180)
        f.raise(late, oncePer(late)) // 상한에 막힌다 — 발송 시각이 없다
        f.clock.now = start.plusSeconds(240)
        f.raise(late, oncePer(late)) // 묶음이 아니라 다시 발송을 시도해 상한에 막힌다

        f.sender.calls shouldBe 2
        f.suppressed("COALESCED") shouldBe 1.0
        f.suppressed("RATE_LIMITED") shouldBe 2.0
        f.notifications.stored.size shouldBe 5
    }

    "묶음 판정이 최근 알림을 읽다 터져도 알림함 행은 남고 푸시를 시도한다 — 위험 알림은 닿는 쪽으로" {
        val f = fixture(recent = ::UnreadableRecent)
        val trip = UUID.randomUUID()

        // 예외가 raise 밖으로 나가면 방금 적재한 행까지 롤백된다(실 DB 는 DomainNotificationIT 가 본다).
        f.raise(trip, oncePer(trip))

        f.notifications.stored.size shouldBe 1
        f.sender.calls shouldBe 1
        f.notifications.stored.single().pushSentAt shouldBe start
        f.suppressed("COALESCED") shouldBe 0.0
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
