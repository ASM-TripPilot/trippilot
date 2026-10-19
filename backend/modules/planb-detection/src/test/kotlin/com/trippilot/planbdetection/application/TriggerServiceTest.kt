package com.trippilot.planbdetection.application

import com.trippilot.core.error.ConflictDetected
import com.trippilot.core.error.ResourceNotFound
import com.trippilot.planbdetection.api.TriggerRef
import com.trippilot.planbdetection.domain.PlanBTrigger
import com.trippilot.planbdetection.domain.PlanBWatch
import com.trippilot.planbdetection.domain.WatchStatus
import org.springframework.beans.factory.ObjectProvider
import com.trippilot.core.event.DomainEventPublisher
import com.trippilot.itinerarygeneration.api.PlannedSlotView
import com.trippilot.planbdetection.api.event.DateRisk
import com.trippilot.planbdetection.api.event.PlanBTriggered
import com.trippilot.planbdetection.domain.TriggerVariant
import java.time.LocalTime
import com.trippilot.itinerarygeneration.api.ItineraryFacade
import com.trippilot.itinerarygeneration.api.ItineraryRef
import com.trippilot.planbdetection.domain.Sensitivity
import com.trippilot.planbdetection.domain.Suppression
import com.trippilot.planbdetection.domain.SuppressionScope
import com.trippilot.planbdetection.domain.TriggerKind
import com.trippilot.planbdetection.domain.TriggerScope
import com.trippilot.planbdetection.domain.TriggerSeverity
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

    val trips = object : TripFacade {
        override fun findPeriod(accountId: UUID, tripId: UUID) =
            if (accountId == acc) TripPeriod(LocalDate.parse("2026-08-10"), LocalDate.parse("2026-08-12")) else null
        override fun findGenerationContext(accountId: UUID, tripId: UUID) = null
    }

    val itineraries = object : ItineraryFacade {
        override fun findCurrent(accountId: UUID, tripId: UUID) =
            if (accountId == acc) ItineraryRef(itineraryId, "PLANNED", "COMPLETE", listOf(day), listOf(slotA)) else null
    }

    fun service(
        triggers: InMemoryTriggers,
        suppressions: InMemorySuppressions = InMemorySuppressions(),
        clock: Clock = clockAt("2026-08-11T03:00:00Z"),
        s: Sensitivity = Sensitivity.NORMAL,
        events: DomainEventPublisher = NoEvents,
        watches: InMemoryWatches = InMemoryWatches(),
        watching: ObjectProvider<WatchingSources> = watchingProvider(),
    ) = triggerService(trips, itineraries, clock, triggers, suppressions, s, events, watches, watching)

    fun signal(slotKey: String? = slotA, kind: TriggerKind = TriggerKind.WEATHER) = DetectionSignal(
        kind = kind, affectedDate = day, slotKey = slotKey,
        payload = mapOf("pop" to 70), reason = "비 예보 70%", scope = TriggerScope.PARTIAL_SLOTS,
    )

    "발화하면 ACTIVE 로 기록되고 트리거를 돌려준다" {
        val triggers = InMemoryTriggers()
        val t = service(triggers).evaluate(acc, tripId, signal())!!

        t.state shouldBe TriggerState.ACTIVE
        t.shouldReplan shouldBe true
        t.scope shouldBe TriggerScope.PARTIAL_SLOTS
        t.itineraryId shouldBe itineraryId
        triggers.stored.size shouldBe 1
    }

    "억제돼도 판정은 기록된다 — 무발화의 근거가 관측에 남아야 한다(정본 §2.1)" {
        val triggers = InMemoryTriggers()
        val suppressions = InMemorySuppressions().apply {
            save(Suppression.of(tripId, TriggerKind.WEATHER, slotA, SuppressionScope.SLOT, Instant.parse("2026-08-11T00:00:00Z")))
        }
        val result = service(triggers, suppressions).evaluate(acc, tripId, signal())

        result shouldBe null                       // 발화하지 않는다
        triggers.stored.size shouldBe 1            // 그러나 행은 남는다
        triggers.stored.single().state shouldBe TriggerState.SUPPRESSED
        triggers.stored.single().shouldReplan shouldBe false // INV-U4-01 — 화면에 노출될 수 없다
    }

    "남은 일정에 닿지 않으면 EXPIRED 로 기록한다(BR-U4-06)" {
        val triggers = InMemoryTriggers()
        service(triggers).evaluate(acc, tripId, signal(slotKey = "$day#${UUID.randomUUID()}")) shouldBe null
        triggers.stored.single().state shouldBe TriggerState.EXPIRED
    }

    "여행 구간 밖이면 행조차 만들지 않는다(BR-U4-02)" {
        val triggers = InMemoryTriggers()
        service(triggers, clock = clockAt("2026-08-20T03:00:00Z")).evaluate(acc, tripId, signal()) shouldBe null
        triggers.stored.size shouldBe 0 // 구간 밖에서는 어떤 트리거도 만들지 않는다
    }

    "하루 상한을 넘으면 푸시만 빠진다 — 사건·배너는 남는다(push=false · 규칙 11)" {
        val triggers = InMemoryTriggers()
        val events = RecordingEvents()
        val svc = service(triggers, s = Sensitivity.LOW, events = events) // 상한 2
        svc.evaluate(acc, tripId, signal(slotKey = slotA))
        svc.evaluate(acc, tripId, signal(slotKey = null, kind = TriggerKind.DELAY))
        val third = svc.evaluate(acc, tripId, signal(slotKey = null, kind = TriggerKind.CLOSURE))!!

        third.state shouldBe TriggerState.ACTIVE // 배너는 선다
        third.pushedAt shouldBe null            // 푸시 대상이 아니었다
        triggers.stored.count { it.state == TriggerState.ACTIVE } shouldBe 3
        events.published.map { (it as PlanBTriggered).push } shouldBe listOf(true, true, false)
    }

    "화면에는 발화분만 나간다(INV-U4-01)" {
        val triggers = InMemoryTriggers()
        val svc = service(triggers)
        svc.evaluate(acc, tripId, signal())
        svc.evaluate(acc, tripId, signal(slotKey = "$day#${UUID.randomUUID()}")) // EXPIRED 로 기록됨

        svc.listActive(acc, tripId).size shouldBe 1
        triggers.stored.size shouldBe 2 // 기록은 둘
    }

    "끄기는 억제 레코드를 만든다 — 배너만 감추는 게 아니다(BR-U4-15)" {
        val triggers = InMemoryTriggers()
        val suppressions = InMemorySuppressions()
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
        val triggers = InMemoryTriggers()
        val suppressions = InMemorySuppressions()
        val svc = service(triggers, suppressions)
        val t = svc.evaluate(acc, tripId, signal(slotKey = null))!!
        svc.dismiss(acc, tripId, t.triggerId)

        suppressions.stored.single().scopeType shouldBe SuppressionScope.DAY
        svc.evaluate(acc, tripId, signal(slotKey = slotA)) shouldBe null // 그 날 같은 사유는 전부 막힌다
    }

    "날짜 전체 알림을 꺼도 다음 날은 다시 알린다 — DAY 억제는 그 날로 끝난다" {
        // 만료를 안 두면 covers 가 슬롯을 가리지 않으므로 사실상 여행 전체가 꺼진다.
        // 오늘 비 알림을 한 번 껐다고 내일치까지 막으면 사용자는 정작 필요한 알림을 못 받는다.
        val triggers = InMemoryTriggers()
        val suppressions = InMemorySuppressions()
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
        val triggers = InMemoryTriggers()
        val suppressions = InMemorySuppressions()
        val svc = service(triggers, suppressions)
        val t = svc.evaluate(acc, tripId, signal(slotKey = slotA))!!
        svc.dismiss(acc, tripId, t.triggerId)

        val off = suppressions.stored.single()
        off.scopeType shouldBe SuppressionScope.SLOT
        off.expiresAt shouldBe null
    }

    "지난 날짜 슬롯 신호는 폐기한다 — 어제 알림이 오늘 뜨면 이유를 알 수 없다(BR-U4-06)" {
        val triggers = InMemoryTriggers()
        // 일정에는 어제 슬롯도 남아 있다(일정은 여행 전체를 담는다)
        val past = "2026-08-10#${UUID.randomUUID()}"
        val withPast = object : ItineraryFacade {
            override fun findCurrent(accountId: UUID, tripId: UUID) =
                ItineraryRef(itineraryId, "PLANNED", "COMPLETE", listOf(day), listOf(past, slotA))
        }
        val svc = triggerService(trips, withPast, clockAt("2026-08-11T03:00:00Z"), triggers)

        svc.evaluate(acc, tripId, signal(slotKey = past)) shouldBe null
        triggers.stored.single().state shouldBe TriggerState.EXPIRED
    }

    "범위가 NONE 인 신호는 발화하지 않는다 — 배너만 뜨고 [대안 보기] 가 열 세션이 없으면 막다른 길이다" {
        val triggers = InMemoryTriggers()
        val svc = service(triggers)
        val none = signal().copy(scope = TriggerScope.NONE)

        svc.evaluate(acc, tripId, none) shouldBe null
        triggers.stored.single().shouldReplan shouldBe false // 기록은 남되 발화는 아니다
    }

    "이미 닫힌 트리거는 다시 끌 수 없다(409) · 남의 여행 트리거는 404" {
        val triggers = InMemoryTriggers()
        val svc = service(triggers)
        val t = svc.evaluate(acc, tripId, signal())!!
        svc.dismiss(acc, tripId, t.triggerId)
        shouldThrow<ConflictDetected> { svc.dismiss(acc, tripId, t.triggerId) }

        shouldThrow<ResourceNotFound> { svc.dismiss(acc, UUID.randomUUID(), t.triggerId) }
        shouldThrow<ResourceNotFound> { svc.listActive(UUID.randomUUID(), tripId) }
    }

    "끄기는 끈 트리거의 날짜·심각도를 억제에 적는다 — 주의를 끈 것이 같은 날 위험을 막지 않는다(규칙 10)" {
        val triggers = InMemoryTriggers()
        val suppressions = InMemorySuppressions()
        val svc = service(triggers, suppressions)
        val caution = svc.evaluate(acc, tripId, signal(slotKey = null).copy(severity = TriggerSeverity.CAUTION))!!
        svc.dismiss(acc, tripId, caution.triggerId)

        val off = suppressions.stored.single()
        off.affectedDate shouldBe day
        off.maxSeverity shouldBe TriggerSeverity.CAUTION
        // 같은 날 같은 대상의 위험은 막지 않는다
        svc.evaluate(acc, tripId, signal(slotKey = null))!!.severity shouldBe TriggerSeverity.RISK
    }

    // ── 단건 판정(evaluate) 의 새 의미 ─────────────────────────────────
    "발화 사건에 대표의 날짜·범위·심각도·변형·푸시·외 N건·그 날 위험이 실린다" {
        val events = RecordingEvents()
        val t = service(InMemoryTriggers(), events = events).evaluate(
            acc, tripId, signal(slotKey = slotA, kind = TriggerKind.CLOSURE).copy(variant = TriggerVariant.CLOSED_DAY),
        )!!
        val e = events.published.single() as PlanBTriggered
        e.aggregateId shouldBe t.triggerId.toString()
        e.affectedDate shouldBe "2026-08-11"
        e.scope shouldBe "PARTIAL_SLOTS"
        e.severity shouldBe "RISK"
        e.variant shouldBe "CLOSED_DAY"
        e.push shouldBe true
        e.others shouldBe 0
        e.dateRisks shouldBe listOf(DateRisk("CLOSURE", "CLOSED_DAY", listOf(slotA.substringAfter('#'))))
    }

    // G-SA-11 — 선계산(C10)은 날씨 위험의 영향 POI 를 영향 범위가 일부(SOME)일 때만 뺀다. 그 사실은 트리거 payload 에만
    // 있어서 사건 항목에 실어야 C10 이 가를 수 있다(매핑은 C10 몫 — 여기서는 사실만 옮긴다).
    "그 날 위험 항목에 날씨 영향 범위(coverage)가 실린다 — 없으면 null" {
        val events = RecordingEvents()
        service(InMemoryTriggers(), events = events).evaluate(
            acc, tripId,
            signal(slotKey = null).copy(variant = TriggerVariant.RAIN, payload = mapOf("pop" to 80, PlanBTrigger.PAYLOAD_COVERAGE to "SOME")),
        )
        (events.published.single() as PlanBTriggered).dateRisks!!.single().coverage shouldBe "SOME"

        val plain = RecordingEvents()
        service(InMemoryTriggers(), events = plain).evaluate(acc, tripId, signal(slotKey = null))
        (plain.published.single() as PlanBTriggered).dateRisks!!.single().coverage shouldBe null
    }

    "같은 대상이 이미 떠 있으면 제자리 갱신하고 null — 배너가 늘지 않는다(CD9)" {
        val triggers = InMemoryTriggers()
        val svc = service(triggers)
        val first = svc.evaluate(acc, tripId, signal(slotKey = null))!!
        svc.evaluate(acc, tripId, signal(slotKey = null).copy(payload = mapOf("pop" to 90), reason = "비 예보 90%")) shouldBe null

        triggers.stored.single().triggerId shouldBe first.triggerId
        triggers.stored.single().reason shouldBe "비 예보 90%"
    }

    "주의로 알린 대상이 위험으로 오르면 제자리 격상하고 다시 알린다" {
        val triggers = InMemoryTriggers()
        val events = RecordingEvents()
        val svc = service(triggers, events = events)
        val caution = svc.evaluate(acc, tripId, signal(slotKey = null).copy(severity = TriggerSeverity.CAUTION))!!
        val risk = svc.evaluate(acc, tripId, signal(slotKey = null))!!

        risk.triggerId shouldBe caution.triggerId
        risk.severity shouldBe TriggerSeverity.RISK
        events.published.map { (it as PlanBTriggered).severity } shouldBe listOf("CAUTION", "RISK")
    }

    // ── 스윕 회차(reconcile) ───────────────────────────────────────────
    val period = TripPeriod(LocalDate.parse("2026-08-10"), LocalDate.parse("2026-08-12"))
    val noon = Instant.parse("2026-08-11T03:00:00Z") // KST 12:00
    val tomorrowSlot = "${day.plusDays(1)}#${UUID.randomUUID()}"
    val ref = ItineraryRef(itineraryId, "CONFIRMED", "COMPLETE", listOf(day, day.plusDays(1)), listOf(slotA, tomorrowSlot))

    fun planned(slotKey: String, start: String, end: String, name: String?) = PlannedSlotView(
        slotKey = slotKey, date = LocalDate.parse(slotKey.substringBefore('#')),
        poiId = UUID.fromString(slotKey.substringAfter('#')), orderIndex = 0,
        startAt = LocalTime.parse(start), endAt = LocalTime.parse(end),
        isFixed = false, endsNextDay = false, hasViolation = false, nameKo = name,
    )
    val slotViews = listOf(planned(slotA, "18:00", "19:00", "365분식"), planned(tomorrowSlot, "10:00", "11:00", "우도"))

    /** 감지기가 낸 신호 — scope 는 감지기 출력 그대로(FULL_DAY)이고 판정이 교정한다(CD7). */
    fun swept(kind: TriggerKind, slotKey: String?, variant: TriggerVariant, reason: String, date: LocalDate = day) = DetectionSignal(
        kind = kind, affectedDate = date, slotKey = slotKey, payload = emptyMap(), reason = reason,
        scope = TriggerScope.FULL_DAY, variant = variant, dataSource = "KMA_VILAGE",
    )

    fun seen(source: String, kind: TriggerKind, vararg signals: DetectionSignal, date: LocalDate = day) =
        Observation(source, kind, date, Detection.Checked(emptySet(), signals.toList()))

    val closedDay = { swept(TriggerKind.CLOSURE, slotA, TriggerVariant.CLOSED_DAY, "‘365분식’은 정기 휴무일로 나와요") }

    "스윕 회차 — 감지 결과를 쓰고 사건은 1건(대표 + 외 N건), 오늘은 PARTIAL_SLOTS 로 교정한다" {
        val triggers = InMemoryTriggers()
        val events = RecordingEvents()
        val out = service(triggers, events = events).reconcile(
            acc, tripId, period, noon, ref, slotViews,
            listOf(
                seen("kma-forecast", TriggerKind.WEATHER, swept(TriggerKind.WEATHER, null, TriggerVariant.RAIN, "오후에 비 소식이 있어요.")),
                seen("place", TriggerKind.CLOSURE, closedDay()),
            ),
        )
        out shouldBe ReconcileOutcome(announced = true, pushed = true, quiet = 0, expired = 0, dropped = 0)
        val e = events.published.single() as PlanBTriggered
        e.kind shouldBe "WEATHER" // 위험 → 날짜 → 날짜 전체 먼저
        e.others shouldBe 1
        e.dateRisks!!.map { it.kind }.toSet() shouldBe setOf("WEATHER", "CLOSURE")
        val active = triggers.stored.filter { it.state == TriggerState.ACTIVE }
        active.map { it.detector }.toSet() shouldBe setOf("kma-forecast", "place")
        active.all { it.scope == TriggerScope.PARTIAL_SLOTS } shouldBe true
        active.first { it.kind == TriggerKind.WEATHER }.dataSource shouldBe "KMA_VILAGE"
    }

    "저녁 회차 — 내일 신호는 FULL_DAY 의 별개 대상이고, 남은 슬롯이 없는 오늘 날짜 전체 트리거는 닫힌다" {
        val triggers = InMemoryTriggers()
        val svc = service(triggers)
        svc.reconcile(acc, tripId, period, noon, ref, slotViews, listOf(seen("kma-forecast", TriggerKind.WEATHER, swept(TriggerKind.WEATHER, null, TriggerVariant.RAIN, "오후에 비 소식이 있어요."))))

        val evening = Instant.parse("2026-08-11T11:15:00Z") // KST 20:15 — 오늘 슬롯(18~19시)은 끝났다
        val tomorrow = day.plusDays(1)
        val out = svc.reconcile(
            acc, tripId, period, evening, ref, slotViews,
            listOf(seen("kma-forecast", TriggerKind.WEATHER, swept(TriggerKind.WEATHER, null, TriggerVariant.RAIN, "8월 12일(수) 오전에 비 소식이 있어요.", date = tomorrow), date = tomorrow)),
        )
        out.expired shouldBe 1
        val active = triggers.stored.single { it.state == TriggerState.ACTIVE }
        active.affectedDate shouldBe tomorrow
        active.scope shouldBe TriggerScope.FULL_DAY
    }

    "문구 가드에 걸린 신호만 버린다 — 장소명 속 숫자('365분식')는 버리지 않는다(규칙 13)" {
        val triggers = InMemoryTriggers()
        val out = service(triggers).reconcile(
            acc, tripId, period, noon, ref, slotViews,
            listOf(
                seen("kma-forecast", TriggerKind.WEATHER, swept(TriggerKind.WEATHER, null, TriggerVariant.WIND, "이동이 30분 늘어날 수 있어요")),
                seen("place", TriggerKind.CLOSURE, closedDay()),
            ),
        )
        out.dropped shouldBe 1
        triggers.stored.single().kind shouldBe TriggerKind.CLOSURE
    }

    "감지기 계약을 어긴 신호는 버린다 — 종류·날짜·변형·슬롯이 관측과 어긋남" {
        val triggers = InMemoryTriggers()
        val out = service(triggers).reconcile(
            acc, tripId, period, noon, ref, slotViews,
            listOf(
                seen(
                    "kma-forecast", TriggerKind.WEATHER,
                    closedDay(), // 종류가 관측(WEATHER)과 다르다
                    swept(TriggerKind.WEATHER, null, TriggerVariant.RAIN, "8월 12일(수) 비 소식이 있어요.", date = day.plusDays(1)), // 날짜가 관측과 다르다
                    swept(TriggerKind.WEATHER, null, TriggerVariant.HOLIDAY, "오후에 비 소식이 있어요."), // 변형이 종류와 짝이 아니다
                    swept(TriggerKind.WEATHER, "$day#${UUID.randomUUID()}", TriggerVariant.RAIN, "오후에 비 소식이 있어요."), // 그 날 일정에 없는 슬롯
                ),
            ),
        )
        out.dropped shouldBe 4
        triggers.stored shouldBe emptyList()
    }

    "모름은 행을 만들지 않고(INV-U4-09), 같은 회차를 다시 돌려도 행이 늘지 않는다" {
        val triggers = InMemoryTriggers()
        val events = RecordingEvents()
        val svc = service(triggers, events = events)
        svc.reconcile(
            acc, tripId, period, noon, ref, slotViews,
            listOf(Observation("kma-forecast", TriggerKind.WEATHER, day, Detection.Unknown("SERVICE_KEY_IS_NOT_REGISTERED"))),
        )
        triggers.stored shouldBe emptyList()

        val once = listOf(seen("place", TriggerKind.CLOSURE, closedDay()))
        svc.reconcile(acc, tripId, period, noon, ref, slotViews, once)
        svc.reconcile(acc, tripId, period, noon.plusSeconds(3600), ref, slotViews, once)
        triggers.stored.size shouldBe 1
        events.published.size shouldBe 1
    }

    "스윕 밖 종류(DELAY)·허용 밖 날짜 관측은 무시한다 — 해제의 근거도 아니다" {
        val triggers = InMemoryTriggers()
        val svc = service(triggers)
        val delay = svc.evaluate(acc, tripId, signal(slotKey = null, kind = TriggerKind.DELAY))!!
        val farDay = day.plusDays(2) // 여행 구간(08-10~12) 밖
        svc.reconcile(
            acc, tripId, period, noon, ref, slotViews,
            listOf(
                Observation("delay-scan", TriggerKind.DELAY, day, Detection.Checked(setOf(null), emptyList())),
                seen("kma-forecast", TriggerKind.WEATHER, swept(TriggerKind.WEATHER, null, TriggerVariant.RAIN, "8월 13일(목) 비 소식이 있어요.", date = farDay), date = farDay),
            ),
        )
        triggers.findById(delay.triggerId)!!.state shouldBe TriggerState.ACTIVE
        triggers.stored.size shouldBe 1
    }

    "일정이 없어지면 그 여행의 스윕 트리거는 만료되고 새 행도 만들지 않는다" {
        val triggers = InMemoryTriggers()
        val svc = service(triggers)
        val sight = listOf(seen("place", TriggerKind.CLOSURE, closedDay()))
        svc.reconcile(acc, tripId, period, noon, ref, slotViews, sight)

        val out = svc.reconcile(acc, tripId, period, noon, null, emptyList(), sight)
        out.expired shouldBe 1
        out.dropped shouldBe 1 // 일정에 없는 슬롯 신호
        triggers.stored.single().state shouldBe TriggerState.EXPIRED
    }

    // ── 읽기(규칙 14·15) ───────────────────────────────────────────────
    fun put(
        triggers: InMemoryTriggers, kind: TriggerKind, date: LocalDate, slotKey: String?,
        severity: TriggerSeverity, detectedAt: String, detector: String? = null,
    ) = triggers.save(
        PlanBTrigger.active(
            tripId, itineraryId, kind, date, slotKey,
            detector?.let { mapOf(PlanBTrigger.PAYLOAD_DETECTOR to it) } ?: emptyMap(),
            TriggerScope.FULL_DAY, "사유", Instant.parse(detectedAt), severity,
        ),
    )

    "목록은 지난 날·지금 일정에 없는 슬롯·꺼진 출처를 숨기고 위험 → 날짜 → 감지 역순으로 준다(규칙 14 · CD14)" {
        val triggers = InMemoryTriggers()
        val cautionToday = put(triggers, TriggerKind.WEATHER, day, null, TriggerSeverity.CAUTION, "2026-08-11T01:00:00Z")
        val riskTomorrow = put(triggers, TriggerKind.WEATHER, day.plusDays(1), null, TriggerSeverity.RISK, "2026-08-11T02:00:00Z")
        val riskToday = put(triggers, TriggerKind.CLOSURE, day, slotA, TriggerSeverity.RISK, "2026-08-11T00:30:00Z")
        put(triggers, TriggerKind.CLOSURE, day.minusDays(1), null, TriggerSeverity.RISK, "2026-08-10T01:00:00Z") // 지난 날
        put(triggers, TriggerKind.CLOSURE, day, "$day#${UUID.randomUUID()}", TriggerSeverity.RISK, "2026-08-11T01:00:00Z") // 일정에 없는 슬롯
        put(triggers, TriggerKind.WEATHER, day, slotA, TriggerSeverity.RISK, "2026-08-11T01:00:00Z", detector = "kma-forecast") // 감시 안 하는 출처

        service(triggers).listActive(acc, tripId).map { it.triggerId } shouldBe
            listOf(riskToday, riskTomorrow, cautionToday).map { it.triggerId }
    }

    "스윕이 그 출처를 감시 중이면 스윕 트리거도 보인다 — 끄면 즉시 숨는다(회수 · O22)" {
        val triggers = InMemoryTriggers()
        val t = put(triggers, TriggerKind.WEATHER, day, null, TriggerSeverity.RISK, "2026-08-11T01:00:00Z", detector = "kma-forecast")

        service(triggers, watching = watchingProvider("kma-forecast")).listActive(acc, tripId).single().triggerId shouldBe t.triggerId
        service(triggers, watching = watchingProvider("place")).listActive(acc, tripId) shouldBe emptyList()
    }

    "감시 상태 — 스윕이 없으면 셋 다 OFF, 창 안의 확인은 CHECKED, 오래됐거나 모름이면 UNKNOWN, 지연은 늘 OFF" {
        val watches = InMemoryWatches()
        val now = Instant.parse("2026-08-11T03:00:00Z")
        val off = WatchView(WatchView.Status.OFF, null)
        service(InMemoryTriggers(), watches = watches).watch(acc, tripId) shouldBe TriggerWatch(off, off, off)

        val svc = service(InMemoryTriggers(), watches = watches, watching = watchingProvider("kma-forecast", "place"))
        svc.watch(acc, tripId).weather shouldBe WatchView(WatchView.Status.UNKNOWN, null) // 아직 본 적 없음
        watches.upsert(PlanBWatch(tripId, "kma-forecast", WatchStatus.CHECKED, now.minusSeconds(2 * 3600))) // 창 끝(2시간)
        watches.upsert(PlanBWatch(tripId, "place", WatchStatus.CHECKED, now.minusSeconds(15 * 3600))) // 14시간 창 밖
        val w = svc.watch(acc, tripId)
        w.weather shouldBe WatchView(WatchView.Status.CHECKED, now.minusSeconds(2 * 3600))
        w.closure shouldBe WatchView(WatchView.Status.UNKNOWN, now.minusSeconds(15 * 3600))
        w.delay shouldBe off

        watches.upsert(PlanBWatch(tripId, "kma-forecast", WatchStatus.UNKNOWN, now))
        svc.watch(acc, tripId).weather shouldBe WatchView(WatchView.Status.UNKNOWN, null)
        shouldThrow<ResourceNotFound> { svc.watch(UUID.randomUUID(), tripId) }
    }

    "상세 — 상태와 같은 대상의 지금 트리거, 목록에서 숨는 ACTIVE 는 EXPIRED 로 말한다(규칙 15)" {
        val triggers = InMemoryTriggers()
        val svc = service(triggers)
        val first = svc.evaluate(acc, tripId, signal(slotKey = null))!!
        svc.detail(acc, tripId, first.triggerId) shouldBe
            TriggerDetail(triggers.findById(first.triggerId)!!, TriggerState.ACTIVE, first.triggerId)

        svc.dismiss(acc, tripId, first.triggerId)
        val again = put(triggers, TriggerKind.WEATHER, day, null, TriggerSeverity.RISK, "2026-08-11T03:30:00Z")
        svc.detail(acc, tripId, first.triggerId).let {
            it.state shouldBe TriggerState.SUPPRESSED
            it.currentTriggerId shouldBe again.triggerId
        }

        val past = put(triggers, TriggerKind.CLOSURE, day.minusDays(1), null, TriggerSeverity.RISK, "2026-08-10T03:00:00Z")
        svc.detail(acc, tripId, past.triggerId).let {
            it.state shouldBe TriggerState.EXPIRED // 저장은 ACTIVE 지만 지난 날이라 화면에는 해당하지 않는다
            it.currentTriggerId shouldBe null
        }
        shouldThrow<ResourceNotFound> { svc.detail(acc, UUID.randomUUID(), first.triggerId) }
        shouldThrow<ResourceNotFound> { svc.detail(acc, tripId, UUID.randomUUID()) }
    }

    "조회 퍼사드(C10 진입 강제) — 저장된 상태 그대로, 같은 대상의 지금 ACTIVE, 다른 여행·없음은 null" {
        val triggers = InMemoryTriggers()
        val svc = service(triggers)
        val t = svc.evaluate(acc, tripId, signal(slotKey = null))!!

        svc.find(tripId, t.triggerId) shouldBe TriggerRef("WEATHER", "ACTIVE", day, "PARTIAL_SLOTS", t.triggerId)
        svc.find(UUID.randomUUID(), t.triggerId) shouldBe null
        svc.find(tripId, UUID.randomUUID()) shouldBe null
        svc.dismiss(acc, tripId, t.triggerId)
        svc.find(tripId, t.triggerId) shouldBe TriggerRef("WEATHER", "SUPPRESSED", day, "PARTIAL_SLOTS", null)
    }

    // ── 소비(규칙 16) ───────────────────────────────────────────────────
    "소비 — 트리거 날짜와 적용한 날짜가 같고 ACTIVE·EXPIRED 일 때만 CONSUMED, 다시 와도 무동작" {
        val triggers = InMemoryTriggers()
        val svc = service(triggers)
        val active = svc.evaluate(acc, tripId, signal(slotKey = null))!!

        svc.consume(tripId, active.triggerId, day.plusDays(1)) shouldBe false // 다른 날을 다시 짰다
        svc.consume(UUID.randomUUID(), active.triggerId, day) shouldBe false   // 다른 여행
        svc.consume(tripId, UUID.randomUUID(), day) shouldBe false             // 없음
        svc.consume(tripId, active.triggerId, day) shouldBe true
        triggers.findById(active.triggerId)!!.state shouldBe TriggerState.CONSUMED
        svc.consume(tripId, active.triggerId, day) shouldBe false              // 재배달 — 멱등

        val expired = triggers.save(
            PlanBTrigger.active(
                tripId, itineraryId, TriggerKind.CLOSURE, day, slotA, emptyMap(), TriggerScope.PARTIAL_SLOTS, "휴무",
                Instant.parse("2026-08-11T01:00:00Z"),
            ).expired(),
        )
        svc.consume(tripId, expired.triggerId, day) shouldBe true               // 해제 뒤에 적용했다

        val off = svc.evaluate(acc, tripId, signal(slotKey = slotA, kind = TriggerKind.DELAY))!!
        svc.dismiss(acc, tripId, off.triggerId)
        svc.consume(tripId, off.triggerId, day) shouldBe false                  // 끈 알림은 그대로
    }
})
