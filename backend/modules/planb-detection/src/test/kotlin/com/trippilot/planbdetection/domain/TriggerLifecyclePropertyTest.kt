package com.trippilot.planbdetection.domain

import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.shouldBe
import io.kotest.property.Arb
import io.kotest.property.arbitrary.arbitrary
import io.kotest.property.arbitrary.element
import io.kotest.property.arbitrary.enum
import io.kotest.property.arbitrary.int
import io.kotest.property.arbitrary.list
import io.kotest.property.checkAll
import java.time.Instant
import java.time.LocalDate
import java.time.LocalTime
import java.util.UUID

/**
 * 생명주기 PBT(블로킹 게이트 T-D1-P1~P5) — 임의 관측열을 **여러 회차**에 걸쳐 인메모리 행에 적용한다.
 * 함수 하나의 성질이 아니라 회차 사이에 쌓이는 상태(알린 이력·푸시 수·ACTIVE)의 성질이라 행 저장소를 흉내 낸다.
 */
class TriggerLifecyclePropertyTest : StringSpec({

    val tripId = UUID.fromString("00000000-0000-4000-8000-000000000001")
    val itineraryId = UUID.fromString("00000000-0000-4000-8000-000000000002")
    val start = LocalDate.parse("2026-10-19")
    val end = start.plusDays(3)
    val days = (0L..3L).map { start.plusDays(it) }
    val zone = TriggerLifecycle.TRAVEL_ZONE
    /** 날짜마다 오전·오후·저녁 슬롯 — 끝나는 시각이 회차 시각과 엇갈리게. */
    val baseSlots = days.flatMap { d ->
        listOf(LocalTime.of(9, 0), LocalTime.of(13, 0), LocalTime.of(18, 0)).mapIndexed { i, t ->
            TriggerLifecycle.SlotTime("$d#${UUID.nameUUIDFromBytes("$d-$i".toByteArray())}", d, t, t.plusHours(1), false)
        }
    }
    val roundTimes = listOf(LocalTime.of(7, 15), LocalTime.of(12, 15), LocalTime.of(19, 15), LocalTime.of(20, 40))
    val weatherVariants = TriggerVariant.entries.filter { it.kind == TriggerKind.WEATHER }
    val closureVariants = TriggerVariant.entries.filter { it.kind == TriggerKind.CLOSURE }

    data class Round(
        val now: Instant,
        val slots: List<TriggerLifecycle.SlotTime>,
        val looks: List<TriggerLifecycle.Look>,
        val sightings: List<TriggerLifecycle.Sighting>,
    )

    fun sighting(source: String, kind: TriggerKind, date: LocalDate, slotKey: String?, severity: TriggerSeverity, variant: TriggerVariant, today: LocalDate) =
        TriggerLifecycle.Sighting(
            TriggerLifecycle.Target(kind, date, slotKey), severity, variant, TriggerLifecycle.sweepScope(date, today),
            "${variant.name} 신호", mapOf(PlanBTrigger.PAYLOAD_VARIANT to variant.name, PlanBTrigger.PAYLOAD_DETECTOR to source),
        )

    /** 한 회차 — 출처마다 미호출·모름·해소 확인·신호 중 하나. 허용 밖(어제·모레)도 섞는다(판정이 버려야 한다). */
    val roundArb: Arb<Round> = arbitrary {
        val today = Arb.element(days).bind()
        val now = today.atTime(Arb.element(roundTimes).bind()).atZone(zone).toInstant()
        val removed = Arb.element(listOf<String?>(null) + baseSlots.map { it.slotKey }).bind() // 일정 편집 — 슬롯 하나가 빠진다
        val looks = mutableListOf<TriggerLifecycle.Look>()
        val sightings = mutableListOf<TriggerLifecycle.Sighting>()
        for (date in listOf(today.minusDays(1), today, today.plusDays(1), today.plusDays(2))) {
            when (Arb.int(0, 3).bind()) {
                0 -> Unit
                1 -> looks += TriggerLifecycle.Look("kma-forecast", TriggerKind.WEATHER, date, null)
                2 -> looks += TriggerLifecycle.Look("kma-forecast", TriggerKind.WEATHER, date, setOf(null))
                else -> {
                    looks += TriggerLifecycle.Look("kma-forecast", TriggerKind.WEATHER, date, emptySet())
                    sightings += sighting(
                        "kma-forecast", TriggerKind.WEATHER, date, null,
                        Arb.enum<TriggerSeverity>().bind(), Arb.element(weatherVariants).bind(), today,
                    )
                }
            }
            when (Arb.int(0, 2).bind()) {
                0 -> Unit
                1 -> looks += TriggerLifecycle.Look("place", TriggerKind.CLOSURE, date, null)
                else -> {
                    val checked = mutableSetOf<String?>()
                    for (slot in baseSlots.filter { it.date == date }) {
                        when (Arb.int(0, 2).bind()) {
                            0 -> Unit
                            1 -> checked += slot.slotKey
                            else -> sightings += sighting(
                                "place", TriggerKind.CLOSURE, date, slot.slotKey,
                                TriggerSeverity.RISK, Arb.element(closureVariants).bind(), today,
                            )
                        }
                    }
                    looks += TriggerLifecycle.Look("place", TriggerKind.CLOSURE, date, checked)
                }
            }
        }
        Round(now, baseSlots.filter { it.slotKey != removed }, looks, sightings)
    }

    /** 행 저장소 흉내 — 대상당 ACTIVE 가 둘이 되면 던진다(부분 유니크 = P3 의 앞 절반). */
    class Rows {
        val all = LinkedHashMap<UUID, PlanBTrigger>()

        fun apply(plan: TriggerLifecycle.Plan) {
            (plan.updates + plan.inserts).forEach { all[it.triggerId] = it }
            val clash = all.values.filter { it.state == TriggerState.ACTIVE }.groupBy { it.target }.filterValues { it.size > 1 }
            check(clash.isEmpty()) { "대상당 ACTIVE 가 둘 이상입니다: ${clash.keys}" }
        }
    }

    /** 실 저장소가 주는 것과 같은 입력 — ACTIVE 전부, 허용 날짜와 그 전날의 행, 오늘(KST) 푸시 수. */
    fun inputOf(rows: Rows, round: Round, cap: Int): TriggerLifecycle.Input {
        val today = LocalDate.ofInstant(round.now, zone)
        val allowed = TriggerLifecycle.allowedDates(today, start, end, includeTomorrow = true)
        val window = allowed + allowed.map { it.minusDays(1) }
        return TriggerLifecycle.Input(
            tripId = tripId, itineraryId = itineraryId, now = round.now, allowedDates = allowed, slots = round.slots,
            actives = rows.all.values.filter { it.state == TriggerState.ACTIVE },
            history = rows.all.values.filter { it.affectedDate in window },
            suppressions = emptyList(), pushCap = cap,
            pushedToday = rows.all.values.count { it.pushedAt?.let { p -> LocalDate.ofInstant(p, zone) } == today },
            looks = round.looks, sightings = round.sightings, sweep = true,
        )
    }

    /** 단건 경로(U10)가 남긴 DELAY·MANUAL 행 — 스윕이 닫지 않아야 한다(P5). */
    fun seeded() = Rows().apply {
        listOf(TriggerKind.DELAY, TriggerKind.MANUAL).forEach { kind ->
            val t = PlanBTrigger.active(
                tripId, itineraryId, kind, start, null, emptyMap(), TriggerScope.PARTIAL_SLOTS, "지연", start.atStartOfDay(zone).toInstant(),
            )
            all[t.triggerId] = t.copy(version = 0)
        }
    }

    "회차마다 — 대상당 ACTIVE ≤ 1·INV-U4-01, 지난 날·허용 밖·오늘 FULL_DAY 0, 하루 푸시 ≤ 상한, 대상·심각도별 알림 ≤ 1 (T-D1-P1·P3·P4·P5)" {
        checkAll(Arb.int(0, 3), Arb.list(roundArb, 1..8)) { cap, rounds ->
            val rows = seeded()
            val alerts = mutableSetOf<Pair<TriggerLifecycle.Target, TriggerSeverity>>()
            for (round in rounds.sortedBy { it.now }) {
                val input = inputOf(rows, round, cap)
                val before = rows.all.toMap()
                val plan = TriggerLifecycle.plan(input)
                rows.apply(plan) // P3 앞 절반 — 어기면 check 가 던진다
                val today = input.today
                val actives = rows.all.values.filter { it.state == TriggerState.ACTIVE }

                // P3 — ACTIVE ⇒ should_replan ∧ scope ≠ NONE(INV-U4-01)
                actives.all { it.shouldReplan && it.scope != TriggerScope.NONE } shouldBe true
                // P5 — 지난 날 ACTIVE 0 · 오늘 FULL_DAY 0(스윕 종류) · 허용 밖 발화 0 · DELAY·MANUAL 불변
                actives.none { it.kind in TriggerLifecycle.SWEPT_KINDS && it.affectedDate < today } shouldBe true
                actives.none { it.kind in TriggerLifecycle.SWEPT_KINDS && it.affectedDate == today && it.scope == TriggerScope.FULL_DAY } shouldBe true
                plan.inserts.filter { it.state == TriggerState.ACTIVE }.all { it.affectedDate in input.allowedDates } shouldBe true
                rows.all.values.filter { it.kind !in TriggerLifecycle.SWEPT_KINDS } shouldBe
                    before.values.filter { it.kind !in TriggerLifecycle.SWEPT_KINDS }
                // P4 — 하루(KST) 푸시 ≤ 상한, 푸시는 위험 대표·상한 안일 때만
                rows.all.values.mapNotNull { it.pushedAt }.groupingBy { LocalDate.ofInstant(it, zone) }.eachCount()
                    .values.all { it <= cap } shouldBe true
                plan.announcement?.takeIf { it.push }?.let {
                    (it.representative.severity == TriggerSeverity.RISK && input.pushedToday < cap) shouldBe true
                }
                // P4 — 알린 대상이 있으면 사건이 있다(상한을 넘어도 push=false 로 남는다), 회차당 사건 ≤ 1 은 타입이 보장
                val newlyAlerted = (plan.updates + plan.inserts)
                    .filter { it.alertedSeverity != null && it.alertedSeverity != before[it.triggerId]?.alertedSeverity }
                newlyAlerted.isNotEmpty() shouldBe (plan.announcement != null)
                // P1 — 대상·심각도별 알림 사건 ≤ 1
                newlyAlerted.forEach { alerts.add(it.target to it.alertedSeverity!!) shouldBe true }
            }
        }
    }

    "모름은 미호출과 같다 — 시간·일정 만료와 범위 교정 말고는 아무것도 바꾸지 않고 행도 만들지 않는다 (T-D1-P2)" {
        checkAll(Arb.list(roundArb, 0..6), roundArb) { history, probe ->
            val rows = seeded()
            history.sortedBy { it.now }.forEach { rows.apply(TriggerLifecycle.plan(inputOf(rows, it, cap = 2))) }

            val unknown = probe.copy(looks = probe.looks.map { it.copy(checked = null) }, sightings = emptyList())
            val absent = probe.copy(looks = emptyList(), sightings = emptyList())
            val a = TriggerLifecycle.plan(inputOf(rows, unknown, cap = 2))
            val b = TriggerLifecycle.plan(inputOf(rows, absent, cap = 2))

            a.inserts shouldBe emptyList()
            a.announcement shouldBe null
            a.updates shouldBe b.updates
            a.updates.all { it.state == TriggerState.EXPIRED || it.scope == TriggerScope.PARTIAL_SLOTS } shouldBe true
        }
    }

    "민감도가 높을수록 덜 막는다 — 낮은 상한에서 푸시하면 높은 상한에서도 푸시한다" {
        checkAll(Arb.list(roundArb, 0..6), roundArb) { history, probe ->
            val rows = seeded()
            history.sortedBy { it.now }.forEach { rows.apply(TriggerLifecycle.plan(inputOf(rows, it, cap = 2))) }

            val low = TriggerLifecycle.plan(inputOf(rows, probe, Sensitivity.LOW.dailyCap))
            val high = TriggerLifecycle.plan(inputOf(rows, probe, Sensitivity.HIGH.dailyCap))
            if (low.announcement?.push == true) high.announcement?.push shouldBe true
        }
    }
})
