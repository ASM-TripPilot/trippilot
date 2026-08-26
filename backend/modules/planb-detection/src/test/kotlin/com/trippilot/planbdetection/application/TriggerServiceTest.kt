package com.trippilot.planbdetection.application

import com.trippilot.core.error.ConflictDetected
import com.trippilot.core.error.ResourceNotFound
import com.trippilot.itinerarygeneration.api.ItineraryFacade
import com.trippilot.itinerarygeneration.api.ItineraryRef
import com.trippilot.planbdetection.domain.PlanBTrigger
import com.trippilot.planbdetection.domain.PlanBTriggerRepository
import com.trippilot.planbdetection.domain.Sensitivity
import com.trippilot.planbdetection.domain.SensitivityRepository
import com.trippilot.planbdetection.domain.Suppression
import com.trippilot.planbdetection.domain.SuppressionRepository
import com.trippilot.planbdetection.domain.SuppressionScope
import com.trippilot.planbdetection.domain.TriggerKind
import com.trippilot.planbdetection.domain.TriggerScope
import com.trippilot.planbdetection.domain.TriggerState
import com.trippilot.trip.api.TripFacade
import com.trippilot.trip.api.TripPeriod
import io.kotest.assertions.throwables.shouldThrow
import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.shouldBe
import java.time.Clock
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneOffset
import java.util.UUID

/** 발행만 삼키는 싱크(TRIP-550). 발행 여부는 이벤트 테스트가 따로 본다. */
internal object NoEvents : com.trippilot.core.event.DomainEventPublisher {
    override fun publish(event: com.trippilot.core.event.DomainEvent) = Unit
}

/**
 * 감지·억제(C9).
 * 검증 축: **발화하지 않은 판정도 기록**(정본 §2.1) · 화면에는 발화분만(INV-U4-01) ·
 * `[끄기]` 는 억제 레코드를 만든다(BR-U4-15) · 구간 밖에서는 행조차 만들지 않는다(BR-U4-02).
 */
class TriggerServiceTest : StringSpec({

    val acc = UUID.randomUUID()
    val tripId = UUID.randomUUID()
    val itineraryId = UUID.randomUUID()
    val day = LocalDate.parse("2026-08-11")
    val slotA = "$day#${UUID.randomUUID()}"

    fun clockAt(i: String): Clock = Clock.fixed(Instant.parse(i), ZoneOffset.UTC)

    class Triggers : PlanBTriggerRepository {
        val stored = mutableListOf<PlanBTrigger>()
        override fun save(trigger: PlanBTrigger) = trigger.also {
            stored.removeAll { s -> s.triggerId == trigger.triggerId }
            stored += it
        }
        override fun findById(triggerId: UUID) = stored.firstOrNull { it.triggerId == triggerId }
        override fun findActiveByTrip(tripId: UUID) =
            stored.filter { it.tripId == tripId && it.state == TriggerState.ACTIVE }
        override fun countActivatedOn(tripId: UUID, date: LocalDate) =
            stored.count { it.tripId == tripId && it.shouldReplan }
    }

    class Suppressions : SuppressionRepository {
        val stored = mutableListOf<Suppression>()
        override fun save(suppression: Suppression) = suppression.also { stored += it }
        override fun findByTrip(tripId: UUID) = stored.filter { it.tripId == tripId }
    }

    val trips = object : TripFacade {
        override fun findPeriod(accountId: UUID, tripId: UUID) =
            if (accountId == acc) TripPeriod(LocalDate.parse("2026-08-10"), LocalDate.parse("2026-08-12")) else null
        override fun findGenerationContext(accountId: UUID, tripId: UUID) = null
    }

    val itineraries = object : ItineraryFacade {
        override fun findCurrent(accountId: UUID, tripId: UUID) =
            if (accountId == acc) ItineraryRef(itineraryId, "PLANNED", "COMPLETE", listOf(day), listOf(slotA)) else null
    }

    fun sensitivity(s: Sensitivity = Sensitivity.NORMAL) = object : SensitivityRepository {
        override fun of(accountId: UUID) = s
    }

    fun service(
        triggers: Triggers,
        suppressions: Suppressions = Suppressions(),
        clock: Clock = clockAt("2026-08-11T03:00:00Z"),
        s: Sensitivity = Sensitivity.NORMAL,
    ) = TriggerService(trips, itineraries, triggers, suppressions, sensitivity(s), NoEvents, clock)

    fun signal(slotKey: String? = slotA, kind: TriggerKind = TriggerKind.WEATHER) = DetectionSignal(
        kind = kind, affectedDate = day, slotKey = slotKey,
        payload = mapOf("pop" to 70), reason = "비 예보 70%", scope = TriggerScope.PARTIAL_SLOTS,
    )

    "발화하면 ACTIVE 로 기록되고 트리거를 돌려준다" {
        val triggers = Triggers()
        val t = service(triggers).evaluate(acc, tripId, signal())!!

        t.state shouldBe TriggerState.ACTIVE
        t.shouldReplan shouldBe true
        t.scope shouldBe TriggerScope.PARTIAL_SLOTS
        t.itineraryId shouldBe itineraryId
        triggers.stored.size shouldBe 1
    }

    "억제돼도 판정은 기록된다 — 무발화의 근거가 관측에 남아야 한다(정본 §2.1)" {
        val triggers = Triggers()
        val suppressions = Suppressions().apply {
            save(Suppression.of(tripId, TriggerKind.WEATHER, slotA, SuppressionScope.SLOT, Instant.parse("2026-08-11T00:00:00Z")))
        }
        val result = service(triggers, suppressions).evaluate(acc, tripId, signal())

        result shouldBe null                       // 발화하지 않는다
        triggers.stored.size shouldBe 1            // 그러나 행은 남는다
        triggers.stored.single().state shouldBe TriggerState.SUPPRESSED
        triggers.stored.single().shouldReplan shouldBe false // INV-U4-01 — 화면에 노출될 수 없다
    }

    "남은 일정에 닿지 않으면 EXPIRED 로 기록한다(BR-U4-06)" {
        val triggers = Triggers()
        service(triggers).evaluate(acc, tripId, signal(slotKey = "$day#${UUID.randomUUID()}")) shouldBe null
        triggers.stored.single().state shouldBe TriggerState.EXPIRED
    }

    "여행 구간 밖이면 행조차 만들지 않는다(BR-U4-02)" {
        val triggers = Triggers()
        service(triggers, clock = clockAt("2026-08-20T03:00:00Z")).evaluate(acc, tripId, signal()) shouldBe null
        triggers.stored.size shouldBe 0 // 구간 밖에서는 어떤 트리거도 만들지 않는다
    }

    "하루 총량을 넘으면 SUPPRESSED 로 기록한다 — 무발화 판정은 총량에 세지 않는다" {
        val triggers = Triggers()
        val svc = service(triggers, s = Sensitivity.LOW) // cap 2
        svc.evaluate(acc, tripId, signal(slotKey = slotA))
        // 서로 다른 사유로 두 번째 발화
        svc.evaluate(acc, tripId, signal(slotKey = null, kind = TriggerKind.DELAY))
        // 세 번째는 상한
        svc.evaluate(acc, tripId, signal(slotKey = null, kind = TriggerKind.CLOSURE)) shouldBe null

        triggers.stored.count { it.state == TriggerState.ACTIVE } shouldBe 2
        triggers.stored.count { it.state == TriggerState.SUPPRESSED } shouldBe 1
    }

    "화면에는 발화분만 나간다(INV-U4-01)" {
        val triggers = Triggers()
        val svc = service(triggers)
        svc.evaluate(acc, tripId, signal())
        svc.evaluate(acc, tripId, signal(slotKey = "$day#${UUID.randomUUID()}")) // EXPIRED 로 기록됨

        svc.listActive(acc, tripId).size shouldBe 1
        triggers.stored.size shouldBe 2 // 기록은 둘
    }

    "끄기는 억제 레코드를 만든다 — 배너만 감추는 게 아니다(BR-U4-15)" {
        val triggers = Triggers()
        val suppressions = Suppressions()
        val svc = service(triggers, suppressions)
        val t = svc.evaluate(acc, tripId, signal())!!

        val dismissed = svc.dismiss(acc, tripId, t.triggerId)
        dismissed.state shouldBe TriggerState.SUPPRESSED
        dismissed.shouldReplan shouldBe false
        suppressions.stored.single().kind shouldBe TriggerKind.WEATHER
        suppressions.stored.single().scopeType shouldBe SuppressionScope.SLOT

        // 같은 신호가 다시 와도 이제 발화하지 않는다
        svc.evaluate(acc, tripId, signal()) shouldBe null
    }

    "날짜 전체 신호를 끄면 그 날 전체가 억제된다" {
        val triggers = Triggers()
        val suppressions = Suppressions()
        val svc = service(triggers, suppressions)
        val t = svc.evaluate(acc, tripId, signal(slotKey = null))!!
        svc.dismiss(acc, tripId, t.triggerId)

        suppressions.stored.single().scopeType shouldBe SuppressionScope.DAY
        svc.evaluate(acc, tripId, signal(slotKey = slotA)) shouldBe null // 그 날 같은 사유는 전부 막힌다
    }

    "날짜 전체 알림을 꺼도 다음 날은 다시 알린다 — DAY 억제는 그 날로 끝난다" {
        // 만료를 안 두면 covers 가 슬롯을 가리지 않으므로 사실상 여행 전체가 꺼진다.
        // 오늘 비 알림을 한 번 껐다고 내일치까지 막으면 사용자는 정작 필요한 알림을 못 받는다.
        val triggers = Triggers()
        val suppressions = Suppressions()
        val svc = service(triggers, suppressions)
        val t = svc.evaluate(acc, tripId, signal(slotKey = null))!!
        svc.dismiss(acc, tripId, t.triggerId)

        val off = suppressions.stored.single()
        off.scopeType shouldBe SuppressionScope.DAY
        // 그 날 자정(KST)까지만 — 08-11 KST 하루가 끝나는 08-11T15:00Z
        off.expiresAt shouldBe Instant.parse("2026-08-11T15:00:00Z")

        // 같은 날에는 막히고
        off.isEffectiveAt(Instant.parse("2026-08-11T10:00:00Z")) shouldBe true
        // 다음 날에는 다시 알릴 수 있다
        off.isEffectiveAt(Instant.parse("2026-08-11T15:00:01Z")) shouldBe false
    }

    "슬롯 알림을 끄면 만료를 두지 않는다 — 그 방문지는 여행 내내 안 알린다" {
        val triggers = Triggers()
        val suppressions = Suppressions()
        val svc = service(triggers, suppressions)
        val t = svc.evaluate(acc, tripId, signal(slotKey = slotA))!!
        svc.dismiss(acc, tripId, t.triggerId)

        val off = suppressions.stored.single()
        off.scopeType shouldBe SuppressionScope.SLOT
        off.expiresAt shouldBe null
    }

    "지난 날짜 슬롯 신호는 폐기한다 — 어제 알림이 오늘 뜨면 이유를 알 수 없다(BR-U4-06)" {
        val triggers = Triggers()
        // 일정에는 어제 슬롯도 남아 있다(일정은 여행 전체를 담는다)
        val past = "2026-08-10#${UUID.randomUUID()}"
        val withPast = object : ItineraryFacade {
            override fun findCurrent(accountId: UUID, tripId: UUID) =
                ItineraryRef(itineraryId, "PLANNED", "COMPLETE", listOf(day), listOf(past, slotA))
        }
        val svc = TriggerService(trips, withPast, triggers, Suppressions(), sensitivity(), NoEvents, clockAt("2026-08-11T03:00:00Z"))

        svc.evaluate(acc, tripId, signal(slotKey = past)) shouldBe null
        triggers.stored.single().state shouldBe TriggerState.EXPIRED
    }

    "범위가 NONE 인 신호는 발화하지 않는다 — 배너만 뜨고 [대안 보기] 가 열 세션이 없으면 막다른 길이다" {
        val triggers = Triggers()
        val svc = service(triggers)
        val none = signal().copy(scope = TriggerScope.NONE)

        svc.evaluate(acc, tripId, none) shouldBe null
        triggers.stored.single().shouldReplan shouldBe false // 기록은 남되 발화는 아니다
    }

    "이미 닫힌 트리거는 다시 끌 수 없다(409) · 남의 여행 트리거는 404" {
        val triggers = Triggers()
        val svc = service(triggers)
        val t = svc.evaluate(acc, tripId, signal())!!
        svc.dismiss(acc, tripId, t.triggerId)
        shouldThrow<ConflictDetected> { svc.dismiss(acc, tripId, t.triggerId) }

        shouldThrow<ResourceNotFound> { svc.dismiss(acc, UUID.randomUUID(), t.triggerId) }
        shouldThrow<ResourceNotFound> { svc.listActive(UUID.randomUUID(), tripId) }
    }
})
