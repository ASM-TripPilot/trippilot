package com.trippilot.planbdetection.domain

import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.nulls.shouldNotBeNull
import io.kotest.matchers.shouldBe
import java.time.Instant
import java.time.LocalDate
import java.time.LocalTime
import java.util.UUID

/**
 * 생명주기 결정표(설계서 §4.1 규칙 6~12) — 행마다 1건, 만료 원인마다 1건, 사건 1건의 모양(T-D1-U).
 * 순수 함수라 스프링·DB 없이 회차 하나의 입력 → 쓰기·사건을 본다.
 */
class TriggerLifecycleTest : StringSpec({

    val tripId = UUID.randomUUID()
    val itineraryId = UUID.randomUUID()
    val today = LocalDate.parse("2026-10-20") // 화요일
    val tomorrow = today.plusDays(1)
    val zone = TriggerLifecycle.TRAVEL_ZONE
    fun at(date: LocalDate, hour: Int, minute: Int): Instant = date.atTime(hour, minute).atZone(zone).toInstant()
    val noon = at(today, 12, 15)
    val morning = TriggerLifecycle.SlotTime("$today#${UUID.randomUUID()}", today, LocalTime.of(9, 0), LocalTime.of(10, 0), false)
    val evening = TriggerLifecycle.SlotTime("$today#${UUID.randomUUID()}", today, LocalTime.of(18, 0), LocalTime.of(19, 0), false)
    val next = TriggerLifecycle.SlotTime("$tomorrow#${UUID.randomUUID()}", tomorrow, LocalTime.of(10, 0), LocalTime.of(11, 0), false)
    val slots = listOf(morning, evening, next)

    fun payload(variant: TriggerVariant?, detector: String?): Map<String, Any> = buildMap {
        variant?.let { put(PlanBTrigger.PAYLOAD_VARIANT, it.name) }
        detector?.let { put(PlanBTrigger.PAYLOAD_DETECTOR, it) }
    }

    fun sighting(
        kind: TriggerKind = TriggerKind.WEATHER,
        date: LocalDate = today,
        slotKey: String? = null,
        severity: TriggerSeverity = TriggerSeverity.RISK,
        variant: TriggerVariant = TriggerVariant.RAIN,
        source: String = "kma-forecast",
        reason: String = "오후에 비 소식이 있어요.",
    ) = TriggerLifecycle.Sighting(
        TriggerLifecycle.Target(kind, date, slotKey), severity, variant,
        TriggerLifecycle.sweepScope(date, today), reason, payload(variant, source),
    )

    /** 저장돼 있던 행(version 0). 기본은 '위험으로 알렸고 지금 떠 있음'. */
    fun stored(
        kind: TriggerKind = TriggerKind.WEATHER,
        date: LocalDate = today,
        slotKey: String? = null,
        severity: TriggerSeverity = TriggerSeverity.RISK,
        alerted: TriggerSeverity? = severity,
        variant: TriggerVariant? = TriggerVariant.RAIN,
        detector: String? = "kma-forecast",
    ) = PlanBTrigger.active(
        tripId, itineraryId, kind, date, slotKey, payload(variant, detector), TriggerLifecycle.sweepScope(date, today),
        "오후에 비 소식이 있어요.", noon.minusSeconds(3600), severity,
    ).copy(alertedSeverity = alerted, version = 0)

    fun look(
        checked: Set<String?>?, source: String = "kma-forecast",
        kind: TriggerKind = TriggerKind.WEATHER, date: LocalDate = today,
    ) = TriggerLifecycle.Look(source, kind, date, checked)

    fun plan(
        actives: List<PlanBTrigger> = emptyList(),
        history: List<PlanBTrigger> = actives,
        looks: List<TriggerLifecycle.Look> = emptyList(),
        sightings: List<TriggerLifecycle.Sighting> = emptyList(),
        now: Instant = noon,
        slotTimes: List<TriggerLifecycle.SlotTime> = slots,
        suppressions: List<Suppression> = emptyList(),
        pushedToday: Int = 0,
        cap: Int = 5,
        itinerary: UUID? = itineraryId,
        sweep: Boolean = true,
    ) = TriggerLifecycle.plan(
        TriggerLifecycle.Input(
            tripId = tripId, itineraryId = itinerary, now = now,
            allowedDates = TriggerLifecycle.allowedDates(
                LocalDate.ofInstant(now, zone), today.minusDays(1), today.plusDays(3), includeTomorrow = true,
            ),
            slots = slotTimes, actives = actives, history = history, suppressions = suppressions,
            pushCap = cap, pushedToday = pushedToday, looks = looks, sightings = sightings, sweep = sweep,
        ),
    )

    // ── 허용 날짜·범위(규칙 12 · CD7) ────────────────────────────────────
    "허용 날짜 = {오늘, 내일} ∩ 여행 구간 — 내일은 지평이 열 때만 넣는다" {
        TriggerLifecycle.allowedDates(today, today.minusDays(1), today.plusDays(3), includeTomorrow = true) shouldBe setOf(today, tomorrow)
        TriggerLifecycle.allowedDates(today, today.minusDays(1), today, includeTomorrow = true) shouldBe setOf(today)
        // 여행 시작 전날(D-1)은 첫날 하나
        TriggerLifecycle.allowedDates(today.minusDays(1), today, today.plusDays(2), includeTomorrow = true) shouldBe setOf(today)
        TriggerLifecycle.allowedDates(today, today.minusDays(1), today.plusDays(3), includeTomorrow = false) shouldBe setOf(today)
        TriggerLifecycle.allowedDates(today, today.plusDays(1), today.plusDays(3), includeTomorrow = false) shouldBe emptySet()
    }

    "스윕 신호의 범위 — 오늘은 PARTIAL_SLOTS, 미래일은 FULL_DAY" {
        TriggerLifecycle.sweepScope(today, today) shouldBe TriggerScope.PARTIAL_SLOTS
        TriggerLifecycle.sweepScope(tomorrow, today) shouldBe TriggerScope.FULL_DAY
    }

    "어제 저녁에 띄운 '내일' 트리거가 오늘이 되면 범위를 PARTIAL_SLOTS 로 고친다" {
        val fromYesterday = stored().copy(scope = TriggerScope.FULL_DAY)
        val p = plan(actives = listOf(fromYesterday))
        p.updates.single().scope shouldBe TriggerScope.PARTIAL_SLOTS
        p.updates.single().state shouldBe TriggerState.ACTIVE
    }

    // ── 결정표(규칙 9) 행마다 ───────────────────────────────────────────
    "1행 — 모름이면 떠 있는 것도 그대로 둔다(행도 만들지 않는다)" {
        val a = stored()
        val p = plan(actives = listOf(a), looks = listOf(look(null)))
        p.updates shouldBe emptyList()
        p.inserts shouldBe emptyList()
        p.announcement shouldBe null
    }

    "2행 — 그 출처가 해소를 확인하고 아무도 신호를 내지 않으면 해제한다" {
        val a = stored()
        val p = plan(actives = listOf(a), looks = listOf(look(setOf(null))))
        p.updates.single().triggerId shouldBe a.triggerId
        p.updates.single().state shouldBe TriggerState.EXPIRED
        p.expired shouldBe 1
    }

    "3행 — 처음 보는 위험은 발화하고 알린다(푸시 대상)" {
        val p = plan(sightings = listOf(sighting()))
        val fired = p.inserts.single()
        fired.state shouldBe TriggerState.ACTIVE
        fired.scope shouldBe TriggerScope.PARTIAL_SLOTS
        fired.alertedSeverity shouldBe TriggerSeverity.RISK
        fired.pushedAt shouldBe noon
        fired.detector shouldBe "kma-forecast"
        val a = p.announcement.shouldNotBeNull()
        a.representative.triggerId shouldBe fired.triggerId
        a.push shouldBe true
        a.others shouldBe 0
        a.dateRisks.map { it.triggerId } shouldBe listOf(fired.triggerId)
    }

    "4행 — 이미 그 심각도로 알린 대상이 다시 서면 배너만 조용히 되살린다" {
        val old = stored().expired() // 위험으로 알렸고 해제됐다
        val p = plan(history = listOf(old), sightings = listOf(sighting()))
        p.inserts.single().state shouldBe TriggerState.ACTIVE
        p.inserts.single().alertedSeverity shouldBe null
        p.announcement shouldBe null
        p.quiet shouldBe 1
    }

    "5행 — 주의에서 위험으로 오르면 제자리 격상(triggerId 유지)하고 다시 알린다" {
        val a = stored(severity = TriggerSeverity.CAUTION, variant = TriggerVariant.HEAT)
        val p = plan(actives = listOf(a), sightings = listOf(sighting(variant = TriggerVariant.HEAT, reason = "오후에 폭염 예보가 있어요.")))
        val up = p.updates.single()
        up.triggerId shouldBe a.triggerId
        up.severity shouldBe TriggerSeverity.RISK
        up.alertedSeverity shouldBe TriggerSeverity.RISK
        p.inserts shouldBe emptyList()
        p.announcement.shouldNotBeNull().representative.triggerId shouldBe a.triggerId
    }

    "6행 — 그 밖의 변화는 제자리 갱신(triggerId 유지·알림 없음), 같으면 쓰지도 않는다(CD9)" {
        val a = stored(variant = TriggerVariant.RAIN)
        val changed = plan(actives = listOf(a), sightings = listOf(sighting(variant = TriggerVariant.WIND, reason = "오후에 강풍 예보가 있어요.")))
        changed.updates.single().triggerId shouldBe a.triggerId
        changed.updates.single().variant shouldBe TriggerVariant.WIND
        changed.updates.single().reason shouldBe "오후에 강풍 예보가 있어요."
        changed.inserts shouldBe emptyList()
        changed.announcement shouldBe null

        plan(actives = listOf(a), sightings = listOf(sighting(reason = a.reason))).updates shouldBe emptyList()
    }

    "주의로 내려가도 제자리 갱신만 — 다시 오를 때 이미 위험으로 알렸으면 알리지 않는다" {
        val a = stored()
        val down = plan(actives = listOf(a), sightings = listOf(sighting(severity = TriggerSeverity.CAUTION, variant = TriggerVariant.CLOUD)))
        val caution = down.updates.single()
        caution.severity shouldBe TriggerSeverity.CAUTION
        down.announcement shouldBe null
        plan(actives = listOf(caution), sightings = listOf(sighting())).announcement shouldBe null
    }

    "판정에 걸리면(억제·무영향) 무발화 행을 대상·변형·판정당 한 번만 남긴다 — 회차마다 쌓이지 않게" {
        val off = Suppression.of(
            tripId, TriggerKind.WEATHER, null, SuppressionScope.DAY, noon.minusSeconds(60),
            affectedDate = today, maxSeverity = TriggerSeverity.RISK,
        )
        val first = plan(suppressions = listOf(off), sightings = listOf(sighting()))
        first.inserts.single().state shouldBe TriggerState.SUPPRESSED
        first.inserts.single().shouldReplan shouldBe false
        first.announcement shouldBe null
        plan(history = first.inserts, suppressions = listOf(off), sightings = listOf(sighting())).inserts shouldBe emptyList()

        // 남은 일정에 닿지 않으면(정오에 이미 끝난 오전 슬롯) 무영향 — EXPIRED 무발화 행
        val gone = plan(
            sightings = listOf(
                sighting(kind = TriggerKind.CLOSURE, slotKey = morning.slotKey, variant = TriggerVariant.CLOSED_DAY,
                    source = "place", reason = "‘국립제주박물관’은 정기 휴무일로 나와요"),
            ),
        )
        gone.inserts.single().state shouldBe TriggerState.EXPIRED
        gone.inserts.single().shouldReplan shouldBe false
    }

    "격상 신호도 끈 범위 안이면 알리지 않고 제자리 갱신만 한다" {
        val a = stored(severity = TriggerSeverity.CAUTION, variant = TriggerVariant.HEAT)
        val off = Suppression.of(
            tripId, TriggerKind.WEATHER, null, SuppressionScope.DAY, noon.minusSeconds(60),
            affectedDate = today, maxSeverity = TriggerSeverity.RISK,
        )
        val p = plan(actives = listOf(a), suppressions = listOf(off), sightings = listOf(sighting(variant = TriggerVariant.HEAT, reason = "오후에 폭염 예보가 있어요.")))
        p.updates.single().severity shouldBe TriggerSeverity.RISK
        p.announcement shouldBe null
    }

    // ── 만료(규칙 8) ────────────────────────────────────────────────────
    "만료 — 지난 날 · 오늘 끝난 슬롯 · 일정에서 빠진 슬롯은 닫고 남은 슬롯은 둔다" {
        val past = stored(date = today.minusDays(1))
        val passed = stored(kind = TriggerKind.CLOSURE, slotKey = morning.slotKey, variant = TriggerVariant.CLOSED_DAY, detector = "place")
        val gone = stored(kind = TriggerKind.CLOSURE, slotKey = "$today#${UUID.randomUUID()}", variant = TriggerVariant.CLOSED_DAY, detector = "place")
        val keep = stored(kind = TriggerKind.CLOSURE, slotKey = evening.slotKey, variant = TriggerVariant.CLOSED_DAY, detector = "place")
        val p = plan(actives = listOf(past, passed, gone, keep))
        p.updates.map { it.triggerId }.toSet() shouldBe setOf(past.triggerId, passed.triggerId, gone.triggerId)
        p.updates.all { it.state == TriggerState.EXPIRED } shouldBe true
        p.expired shouldBe 3
    }

    "만료 — 날짜 전체 신호는 그 날 남은 슬롯이 없거나 그 날짜가 일정에서 빠지면 닫힌다" {
        plan(actives = listOf(stored()), now = at(today, 20, 40)).updates.single().state shouldBe TriggerState.EXPIRED
        plan(actives = listOf(stored(date = tomorrow)), slotTimes = listOf(morning, evening)).updates.single().state shouldBe TriggerState.EXPIRED
    }

    "자정을 넘기는 슬롯은 오늘 안에 끝난 것으로 보지 않는다" {
        val late = TriggerLifecycle.SlotTime("$today#${UUID.randomUUID()}", today, LocalTime.of(23, 0), LocalTime.of(1, 0), true)
        val bar = stored(kind = TriggerKind.CLOSURE, slotKey = late.slotKey, variant = TriggerVariant.OUT_OF_HOURS, detector = "place")
        plan(actives = listOf(bar), slotTimes = listOf(late)).updates shouldBe emptyList()
    }

    "DELAY·MANUAL 은 스윕이 만료·해제하지 않는다(U10 확정 전)" {
        val delay = stored(kind = TriggerKind.DELAY, date = today.minusDays(1), variant = null, detector = null)
        val manual = stored(kind = TriggerKind.MANUAL, date = today.minusDays(1), variant = null, detector = "kma-forecast")
        val looks = listOf(look(setOf(null), kind = TriggerKind.MANUAL, date = today.minusDays(1)))
        plan(actives = listOf(delay, manual), looks = looks).updates shouldBe emptyList()
    }

    "단건 판정(날씨 확인·U10)은 만료·교정·해제를 하지 않는다 — 스윕의 몫이다" {
        val past = stored(date = today.minusDays(1))
        val fullToday = stored().copy(scope = TriggerScope.FULL_DAY)
        plan(actives = listOf(past, fullToday), looks = listOf(look(setOf(null))), sweep = false).updates shouldBe emptyList()
    }

    // ── 출처별 해제(규칙 7) ─────────────────────────────────────────────
    "출처별 해제 — 특보가 모름이어도 단기예보가 해소를 확인하면 단기예보 트리거는 닫힌다" {
        val rain = stored(detector = "kma-forecast")
        val p = plan(actives = listOf(rain), looks = listOf(look(null, source = "kma-warning"), look(setOf(null), source = "kma-forecast")))
        p.updates.single().state shouldBe TriggerState.EXPIRED
    }

    "다른 출처의 확인으로는 닫지 않는다 · 다른 출처가 같은 대상에 신호를 내면 닫지 않고 그 신호로 갱신한다" {
        val rain = stored(detector = "kma-forecast")
        plan(actives = listOf(rain), looks = listOf(look(setOf(null), source = "kma-warning"))).updates shouldBe emptyList()

        val p = plan(
            actives = listOf(rain),
            looks = listOf(look(setOf(null), source = "kma-forecast"), look(emptySet(), source = "kma-warning")),
            sightings = listOf(sighting(variant = TriggerVariant.WIND, source = "kma-warning", reason = "기상청이 제주에 강풍주의보를 발표했어요.")),
        )
        p.updates.single().state shouldBe TriggerState.ACTIVE
        p.updates.single().detector shouldBe "kma-warning" // 해제 자격이 지금 신호의 출처로 옮겨 간다
    }

    "detector 없는 옛 행(날씨 확인)은 해소 확인으로 닫히지 않는다 — 시간·일정 만료로만" {
        plan(actives = listOf(stored(detector = null)), looks = listOf(look(setOf(null)))).updates shouldBe emptyList()
    }

    // ── 관측 접기 ───────────────────────────────────────────────────────
    "같은 대상에 두 출처가 신호를 내면 무거운 쪽 하나로 접는다" {
        val p = plan(
            sightings = listOf(
                sighting(severity = TriggerSeverity.CAUTION, variant = TriggerVariant.HEAT, reason = "오후에 폭염 예보가 있어요."),
                sighting(variant = TriggerVariant.HEAT, source = "kma-warning", reason = "기상청이 제주에 폭염경보를 발표했어요."),
            ),
        )
        p.inserts.single().severity shouldBe TriggerSeverity.RISK
        p.inserts.single().detector shouldBe "kma-warning"
    }

    "같은 무게면 지금 떠 있는 것과 같은 출처·변형을 고른다 — 문구가 회차마다 뒤집히지 않게" {
        val a = stored()
        val p = plan(
            actives = listOf(a),
            sightings = listOf(
                sighting(variant = TriggerVariant.WIND, source = "kma-warning", reason = "기상청이 제주에 강풍주의보를 발표했어요."),
                sighting(reason = a.reason),
            ),
        )
        p.updates shouldBe emptyList()
    }

    "허용 날짜 밖 신호는 버린다(행 없음) · 일정이 없으면 새 행을 만들지 않는다" {
        plan(sightings = listOf(sighting(date = today.plusDays(2)), sighting(date = today.minusDays(1)))).inserts shouldBe emptyList()
        plan(itinerary = null, sightings = listOf(sighting())).inserts shouldBe emptyList()
    }

    // ── 연일 반복·되살림(규칙 9 · UQ11) ─────────────────────────────────
    "연일 반복 — 어제 같은 변형·심각도로 알린 날짜 전체 위험은 오늘 조용히 선다, 변형이 다르면 알린다" {
        val yesterday = stored(date = today.minusDays(1)).expired()
        val same = plan(history = listOf(yesterday), sightings = listOf(sighting()))
        same.inserts.single().state shouldBe TriggerState.ACTIVE
        same.announcement shouldBe null

        val other = plan(history = listOf(yesterday), sightings = listOf(sighting(variant = TriggerVariant.WIND, reason = "오후에 강풍 예보가 있어요.")))
        other.announcement.shouldNotBeNull()
    }

    "적용(CONSUMED)한 대상도 여전히 위험이면 배너가 조용히 되살아난다 — 말하지 않는 침묵을 막는다" {
        val consumed = stored(kind = TriggerKind.CLOSURE, slotKey = evening.slotKey, variant = TriggerVariant.CLOSED_DAY, detector = "place").consumed()
        val p = plan(
            history = listOf(consumed),
            sightings = listOf(
                sighting(kind = TriggerKind.CLOSURE, slotKey = evening.slotKey, variant = TriggerVariant.CLOSED_DAY,
                    source = "place", reason = "‘국립제주박물관’은 정기 휴무일로 나와요"),
            ),
        )
        p.inserts.single().state shouldBe TriggerState.ACTIVE
        p.announcement shouldBe null
    }

    // ── 사건(규칙 11) ───────────────────────────────────────────────────
    "하루 푸시 상한을 넘어도 위험 사건은 낸다 — 푸시만 빠진다 · 주의 대표는 푸시하지 않는다" {
        val capped = plan(pushedToday = 5, cap = 5, sightings = listOf(sighting()))
        capped.announcement.shouldNotBeNull().push shouldBe false
        capped.inserts.single().pushedAt shouldBe null
        capped.inserts.single().alertedSeverity shouldBe TriggerSeverity.RISK

        val caution = plan(sightings = listOf(sighting(severity = TriggerSeverity.CAUTION, variant = TriggerVariant.CLOUD, reason = "야경 시간대에 구름이 많아요.")))
        caution.announcement.shouldNotBeNull().push shouldBe false
        caution.inserts.single().pushedAt shouldBe null
    }

    "대표는 위험 → 이른 날짜 → 날짜 전체 → 이른 슬롯이고, 나머지는 외 N건이다" {
        val early = at(today, 8, 15) // 오전 슬롯이 아직 남아 있다
        val risks = listOf(
            sighting(date = tomorrow),
            sighting(kind = TriggerKind.CLOSURE, slotKey = evening.slotKey, variant = TriggerVariant.CLOSED_DAY,
                source = "place", reason = "‘흑돼지거리 식당’은 정기 휴무일로 나와요"),
            sighting(kind = TriggerKind.CLOSURE, slotKey = morning.slotKey, variant = TriggerVariant.CLOSED_DAY,
                source = "place", reason = "‘국립제주박물관’은 정기 휴무일로 나와요"),
        )
        val bySlot = plan(now = early, sightings = risks + sighting(severity = TriggerSeverity.CAUTION, variant = TriggerVariant.CLOUD, reason = "야경 시간대에 구름이 많아요."))
        bySlot.announcement!!.representative.slotKey shouldBe morning.slotKey
        bySlot.announcement!!.others shouldBe 3

        val dayWide = plan(now = early, sightings = risks + sighting())
        dayWide.announcement!!.representative.target shouldBe TriggerLifecycle.Target(TriggerKind.WEATHER, today, null)
    }

    "dateRisks 는 대표 날짜의 ACTIVE 위험 전부(이번 것 포함) — 주의·다른 날은 빠진다" {
        val closure = stored(kind = TriggerKind.CLOSURE, slotKey = evening.slotKey, variant = TriggerVariant.CLOSED_DAY, detector = "place")
        val cautious = stored(kind = TriggerKind.CLOSURE, severity = TriggerSeverity.CAUTION, variant = TriggerVariant.CLOSED_DAY, detector = "place")
        val tomorrowRisk = stored(date = tomorrow)
        val p = plan(actives = listOf(closure, cautious, tomorrowRisk), sightings = listOf(sighting()))
        p.announcement!!.dateRisks.map { it.target }.toSet() shouldBe setOf(
            TriggerLifecycle.Target(TriggerKind.WEATHER, today, null),
            TriggerLifecycle.Target(TriggerKind.CLOSURE, today, evening.slotKey),
        )
    }
})
