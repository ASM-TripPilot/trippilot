package com.trippilot.notification.adapter.`in`.event

import ch.qos.logback.classic.Level
import ch.qos.logback.classic.Logger
import ch.qos.logback.classic.spi.ILoggingEvent
import ch.qos.logback.core.read.ListAppender
import com.fasterxml.jackson.databind.ObjectMapper
import com.trippilot.core.event.EventEnvelope
import com.trippilot.notification.application.FakeNotifications
import com.trippilot.notification.application.FakeToggles
import com.trippilot.notification.application.FakeTripOwner
import com.trippilot.notification.application.NotificationMetrics
import com.trippilot.notification.application.NotificationRaiseService
import com.trippilot.notification.application.NotificationToggleService
import com.trippilot.notification.application.PushDispatchService
import com.trippilot.notification.application.PushRateLimits
import com.trippilot.notification.domain.DevicePlatform
import com.trippilot.notification.domain.NotificationKind
import com.trippilot.notification.domain.OsPermission
import com.trippilot.notification.domain.PushMessage
import com.trippilot.notification.domain.PushPort
import com.trippilot.notification.domain.PushReceipt
import com.trippilot.notification.domain.PushStatus
import com.trippilot.notification.domain.PushToken
import com.trippilot.notification.domain.PushTokenRepository
import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.shouldBe
import io.kotest.property.Arb
import io.kotest.property.arbitrary.int
import io.kotest.property.checkAll
import io.micrometer.core.instrument.simple.SimpleMeterRegistry
import org.slf4j.LoggerFactory
import java.time.Clock
import java.time.Duration
import java.time.Instant
import java.time.ZoneId
import java.time.ZoneOffset
import java.util.UUID

/**
 * Plan-B 사건 → 알림(BR-SA-21 ①②③④). 구독자 단위 스펙이 처음 생긴 자리다.
 *
 * 이 경로의 결함은 전부 **조용하다** — payload 키 하나를 잘못 읽으면 예외 없이 제목이 종전 상수로
 * 돌아가거나, 주의(`push=false`)가 위험처럼 기기를 울리거나, 반대로 위험이 알림함에만 쌓인다.
 * 알림함 행은 어느 쪽이든 멀쩡하다.
 *
 * payload 는 발행측 DTO(`PlanBTriggered`)의 직렬화 모양을 손으로 옮긴 것이다 — 이 모듈은 발행측을
 * 참조하지 않는다(R1). 실제 DTO 를 직렬화한 모양은 app `DomainNotificationIT` 가 관통으로 본다.
 */
class PlanBTriggeredSubscriberTest : StringSpec({

    val acc = UUID.randomUUID()
    val start = Instant.parse("2026-10-19T00:15:00Z")
    val mapper = ObjectMapper()

    class MovingClock(var now: Instant) : Clock() {
        override fun getZone(): ZoneId = ZoneOffset.UTC
        override fun withZone(zone: ZoneId?): Clock = this
        override fun instant(): Instant = now
    }

    class OneDevice : PushTokenRepository {
        override fun register(token: PushToken) = token
        override fun findActive(accountId: UUID) = listOf(
            PushToken(
                UUID.randomUUID(), accountId, "ExponentPushToken[planb]", null,
                DevicePlatform.ANDROID, OsPermission.GRANTED, Instant.EPOCH, null,
            ),
        )
        override fun invalidate(token: String, at: Instant) = false
        override fun remove(accountId: UUID, token: String) = false
    }

    /** 나간 메시지를 붙든다 — 기기에 무엇이 떴는지(제목·탭 목적지)는 메시지를 봐야 안다. */
    class RecordingSender : PushPort {
        override val deliversExternally = true
        val messages = mutableListOf<PushMessage>()
        override fun send(tokens: List<String>, message: PushMessage): List<PushReceipt> {
            messages += message
            return tokens.map { PushReceipt(it, PushStatus.SENT) }
        }
    }

    class Fixture(
        val clock: MovingClock,
        val notifications: FakeNotifications,
        val sender: RecordingSender,
        val registry: SimpleMeterRegistry,
        val subscriber: PlanBTriggeredSubscriber,
    ) {
        fun suppressed(reason: String) = registry.counter(NotificationMetrics.SUPPRESSED, "reason", reason).count()
    }

    /** 토글 행이 없는 계정 — 실제 대부분의 계정이 이 모양이다(PLAN_B 푸시 기본 ON). */
    fun fixture(): Fixture {
        val clock = MovingClock(start)
        val notifications = FakeNotifications()
        val toggles = NotificationToggleService(FakeToggles(), clock)
        val registry = SimpleMeterRegistry()
        val metrics = NotificationMetrics(registry, notifications)
        val sender = RecordingSender()
        val dispatch = PushDispatchService(OneDevice(), notifications, toggles, sender, metrics, PushRateLimits(), clock)
        val service = NotificationRaiseService(notifications, toggles, dispatch, FakeTripOwner(), metrics, clock)
        return Fixture(clock, notifications, sender, registry, PlanBTriggeredSubscriber(service, mapper))
    }

    /** 감지가 지금 내는 사건(대표 + 새 선택 필드 7종). */
    fun current(
        tripId: UUID,
        kind: Any? = "WEATHER",
        reason: String? = "오후에 비 소식이 있어요.",
        push: Any? = true,
        others: Any? = 0,
    ): Map<String, Any?> = mapOf(
        "accountId" to acc.toString(), "tripId" to tripId.toString(), "kind" to kind,
        "slotKey" to "2026-10-19#${UUID.randomUUID()}", "reason" to reason,
        "affectedDate" to "2026-10-19", "scope" to "PARTIAL_SLOTS", "severity" to "RISK", "variant" to "RAIN",
        "push" to push, "others" to others,
        "dateRisks" to listOf(mapOf("kind" to kind, "variant" to "RAIN", "poiIds" to emptyList<String>())),
        "eventType" to "planb.PlanBTriggered", "aggregateType" to "PlanBTrigger",
    )

    /**
     * 새 필드가 생기기 전의 사건 — 위치 인자 6개뿐이다. 배포 순간 아웃박스에 남아 있던 것만 이 모양이다:
     * 지금 발행처(`TriggerService.eventOf`)는 날씨 확인(`evaluate`)을 포함해 언제나 새 필드를 싣는다.
     */
    fun legacy(tripId: UUID, kind: String, reason: String?): Map<String, Any?> = mapOf(
        "accountId" to acc.toString(), "tripId" to tripId.toString(), "kind" to kind,
        "slotKey" to "2026-10-19#${UUID.randomUUID()}", "reason" to reason,
        "eventType" to "planb.PlanBTriggered", "aggregateType" to "PlanBTrigger",
    )

    fun Fixture.deliver(payload: Map<String, Any?>, triggerId: String = UUID.randomUUID().toString()) =
        subscriber.handle(
            EventEnvelope(
                eventId = UUID.randomUUID(), eventType = "planb.PlanBTriggered", schemaVersion = 1,
                aggregateType = "PlanBTrigger", aggregateId = triggerId, correlationId = null,
                occurredAt = clock.now, payload = mapper.writeValueAsString(payload + ("aggregateId" to triggerId)),
            ),
        )

    fun warnings(block: () -> Unit): List<String> {
        val appender = ListAppender<ILoggingEvent>().apply { start() }
        val logger = LoggerFactory.getLogger(PlanBTriggeredSubscriber::class.java) as Logger
        logger.addAppender(appender)
        try {
            block()
        } finally {
            logger.detachAppender(appender)
        }
        return appender.list.filter { it.level == Level.WARN }.map { it.formattedMessage }
    }

    "날씨 위험은 날씨 제목으로 알림함에 쌓이고 푸시까지 간다" {
        val f = fixture()

        f.deliver(current(UUID.randomUUID(), kind = "WEATHER"))

        val n = f.notifications.stored.single()
        n.kind shouldBe NotificationKind.PLAN_B
        n.title shouldBe "날씨가 일정에 영향을 줄 수 있어요"
        n.body shouldBe "오후에 비 소식이 있어요."
        f.sender.messages.single().title shouldBe "날씨가 일정에 영향을 줄 수 있어요"
    }

    "영업 위험은 영업 확인 제목이다" {
        val f = fixture()

        f.deliver(current(UUID.randomUUID(), kind = "CLOSURE", reason = "성산일출봉은 매주 월요일 휴무예요."))

        f.notifications.stored.single().title shouldBe "가려던 곳의 영업을 확인해 주세요"
    }

    "지연·수동 사건은 종전 제목 그대로다" {
        listOf("DELAY", "MANUAL").forEach { kind ->
            val f = fixture()

            f.deliver(current(UUID.randomUUID(), kind = kind, reason = "다음 일정까지 여유가 줄었어요."))

            f.notifications.stored.single().title shouldBe "일정을 다시 짜는 게 좋겠어요"
            f.sender.messages.size shouldBe 1
        }
    }

    "같이 알린 대상이 있으면 본문 끝에 외 N건을 붙인다 — 없으면 붙이지 않는다" {
        val many = fixture()
        many.deliver(current(UUID.randomUUID(), others = 2))
        many.notifications.stored.single().body shouldBe "오후에 비 소식이 있어요. (외 2건)"

        val one = fixture()
        one.deliver(current(UUID.randomUUID(), others = 0))
        one.notifications.stored.single().body shouldBe "오후에 비 소식이 있어요."
    }

    "사유가 없으면 상대 날짜어 없는 기본 본문이다" {
        val f = fixture()

        f.deliver(current(UUID.randomUUID(), reason = null, others = 3))

        // 종전 기본 본문은 '오늘'을 담아 알림함에 남으면 다음 날 틀린 말이 됐다(BR-SA-12).
        f.notifications.stored.single().body shouldBe "일정에 영향을 주는 상황이 감지됐어요 (외 3건)"
    }

    "빈 사유도 사유가 없는 것이다 — 빈 본문으로 적재가 터지지 않는다" {
        val f = fixture()

        f.deliver(current(UUID.randomUUID(), reason = "  "))

        f.notifications.stored.single().body shouldBe "일정에 영향을 주는 상황이 감지됐어요"
    }

    "외 N건을 붙여 200자를 넘으면 꼬리를 뺀다 — 사유는 자르지 않는다(BR-SA-12 ①)" {
        val fits = "가".repeat(193) // + " (외 2건)" 7자 = 200
        val over = "가".repeat(194)

        val a = fixture()
        a.deliver(current(UUID.randomUUID(), reason = fits, others = 2))
        a.notifications.stored.single().body shouldBe "$fits (외 2건)"

        val b = fixture()
        b.deliver(current(UUID.randomUUID(), reason = over, others = 2))
        b.notifications.stored.single().body shouldBe over

        // 트리거 사유 칸(plan_b_trigger.reason 200자)을 꽉 채운 사유도 그대로다.
        val full = fixture()
        full.deliver(current(UUID.randomUUID(), reason = "가".repeat(200), others = Int.MAX_VALUE))
        full.notifications.stored.single().body shouldBe "가".repeat(200)
    }

    "본문은 어떤 사유 길이·건수에서도 200자 이하다 — 사유는 온전하고 꼬리는 들어갈 때만 붙는다" {
        checkAll(Arb.int(1..200), Arb.int(0..Int.MAX_VALUE)) { length, others ->
            val reason = "가".repeat(length)
            val tail = " (외 ${others}건)"

            val body = PlanBNotificationCopy.body(reason, others)

            (body.length <= 200) shouldBe true
            body shouldBe if (others > 0 && length + tail.length <= 200) reason + tail else reason
        }
    }

    "푸시 대상이 아닌 사건은 알림함에만 둔다 — 기기를 울리지 않는다" {
        val f = fixture()

        f.deliver(current(UUID.randomUUID(), push = false))

        f.notifications.stored.single().pushSentAt shouldBe null
        f.sender.messages.size shouldBe 0
        f.suppressed("IN_APP_ONLY") shouldBe 1.0
    }

    "push 필드가 없는 옛 사건은 종전 제목 그대로 푸시 대상이다 — kind 제목은 새 사건만(BR-SA-21 ①②)" {
        listOf("WEATHER", "CLOSURE").forEach { kind ->
            val f = fixture()
            val trip = UUID.randomUUID()
            val triggerId = UUID.randomUUID().toString()

            f.deliver(legacy(trip, kind = kind, reason = "비 예보로 실내 대안이 필요해요"), triggerId)

            val n = f.notifications.stored.single()
            n.title shouldBe "일정을 다시 짜는 게 좋겠어요"
            n.body shouldBe "비 예보로 실내 대안이 필요해요"
            n.actionPayload shouldBe mapOf("tripId" to trip.toString(), "triggerId" to triggerId)
            f.sender.messages.single().title shouldBe "일정을 다시 짜는 게 좋겠어요"
        }
    }

    "모르는 kind 는 종전 제목으로 알림함에만 두고 경고를 남긴다 — 잘못 들어온 값이 기기를 울리지 않는다" {
        listOf<Any?>("TSUNAMI", null).forEach { kind ->
            val f = fixture()

            val warned = warnings { f.deliver(current(UUID.randomUUID(), kind = kind, push = true)) }

            f.notifications.stored.single().title shouldBe "일정을 다시 짜는 게 좋겠어요"
            f.sender.messages.size shouldBe 0
            f.suppressed("IN_APP_ONLY") shouldBe 1.0
            warned.size shouldBe 1
        }
    }

    "모르는 push 값도 종전 제목으로 알림함에만 두고 경고를 남긴다" {
        listOf<Any?>("yes", 1).forEach { push ->
            val f = fixture()

            val warned = warnings { f.deliver(current(UUID.randomUUID(), kind = "WEATHER", push = push)) }

            f.notifications.stored.single().title shouldBe "일정을 다시 짜는 게 좋겠어요"
            f.sender.messages.size shouldBe 0
            warned.size shouldBe 1
        }
    }

    "액션은 재계획 진입 그대로다 — 날짜·세션 id 를 싣지 않는다" {
        val f = fixture()
        val trip = UUID.randomUUID()
        val triggerId = UUID.randomUUID().toString()

        f.deliver(current(trip), triggerId)

        val n = f.notifications.stored.single()
        n.actionType shouldBe "PLANB_REPLAN"
        n.actionPayload shouldBe mapOf("tripId" to trip.toString(), "triggerId" to triggerId)
        // 기기에 실리는 탭 목적지도 같다 — 앱은 탭 시점에 트리거 상세와 준비된 대안을 조회한다.
        f.sender.messages.single().data shouldBe
            mapOf("actionType" to "PLANB_REPLAN", "tripId" to trip.toString(), "triggerId" to triggerId)
    }

    "같은 여행의 위험이 10분 안에 또 오면 알림함에만 — 다른 여행은 따로 푸시된다" {
        val f = fixture()
        val trip = UUID.randomUUID()

        f.deliver(current(trip, reason = "오후에 비 소식이 있어요."))
        f.clock.now = start.plus(Duration.ofMinutes(5))
        f.deliver(current(trip, kind = "CLOSURE", reason = "성산일출봉은 매주 월요일 휴무예요."))
        f.deliver(current(UUID.randomUUID()))

        f.notifications.stored.size shouldBe 3
        f.notifications.stored[1].pushSentAt shouldBe null
        f.sender.messages.size shouldBe 2
        f.suppressed("COALESCED") shouldBe 1.0
    }

    /**
     * **묶음 키는 여행·슬롯 단위다**(BR-U6-34 재료). 10분 묶음은 이 접두로 같은 여행을 알아본다 — 슬롯이 빠지면
     * 같은 슬롯의 반복을 못 가리고, 슬롯이 없는 사건에 `null` 글자가 끼면 그 사건끼리만 따로 묶인다.
     */
    "억제 키는 PLAN_B#여행#슬롯이다 — 슬롯이 없으면 빈 꼬리다" {
        val f = fixture()
        val trip = UUID.randomUUID()

        f.deliver(current(trip) + ("slotKey" to "2026-10-19#p-1"))
        f.deliver(current(trip) - "slotKey")

        f.notifications.stored.map { it.dedupKey } shouldBe listOf("PLAN_B#$trip#2026-10-19#p-1", "PLAN_B#$trip#")
    }
})
