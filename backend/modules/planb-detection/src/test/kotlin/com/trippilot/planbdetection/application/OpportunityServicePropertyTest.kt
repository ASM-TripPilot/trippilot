package com.trippilot.planbdetection.application

import com.trippilot.itinerarygeneration.api.PlannedSlotView
import com.trippilot.planbdetection.domain.Opportunity
import com.trippilot.planbdetection.domain.OpportunityKind
import com.trippilot.planbdetection.domain.OpportunityQuery
import com.trippilot.planbdetection.domain.OpportunityReply
import com.trippilot.trip.api.TripPeriod
import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.collections.shouldBeEmpty
import io.kotest.matchers.collections.shouldBeSortedWith
import io.kotest.matchers.ints.shouldBeLessThanOrEqual
import io.kotest.matchers.shouldBe
import io.kotest.property.Arb
import io.kotest.property.arbitrary.arbitrary
import io.kotest.property.arbitrary.element
import io.kotest.property.arbitrary.enum
import io.kotest.property.arbitrary.int
import io.kotest.property.arbitrary.list
import io.kotest.property.checkAll
import java.time.LocalDate
import java.time.LocalTime
import java.util.UUID

/**
 * PBT-SA-20(블로킹 게이트) — 기회 조회 · 2차 게이트.
 *
 * 1. 보낸 슬롯의 자격: 그 날짜 · 좌표 있음 · 끝나지 않음 · 방문 순서 앞에서부터 ≤ 8 — 자격 있는 칸이 있으면 반드시 묻는다.
 * 2. 여행 전·범위 밖이면 AI 0회.
 * 3. 임의 AI 응답에도 출력이 계약을 지킨다 — 그리고 멀쩡한 답은 **버리지 않는다**(과잉 거부도 실패다).
 */
class OpportunityServicePropertyTest : StringSpec({

    val owner = UUID.fromString("0d7f17ab-5c4b-4d6d-a7f7-484ba11dda46")
    val tripId = UUID.fromString("7a3c1e2b-0000-4000-8000-000000000002")
    val start = LocalDate.parse("2026-10-19")
    val days = (0L..4L).map { start.plusDays(it) }
    val end = days.last()

    /** 임의 하루 일정 — 시각·길이·자정 넘김·좌표 유무가 섞이고, 저장 순서는 방문 순서와 무관하다. */
    val slotsArb: Arb<List<PlannedSlotView>> = arbitrary {
        val raw = Arb.list(
            arbitrary {
                val date = Arb.element(days).bind()
                val begin = LocalTime.of(Arb.int(0, 23).bind(), Arb.element(0, 15, 30, 45).bind())
                val until = begin.plusMinutes(Arb.int(15, 240).bind().toLong())
                val placed = Arb.int(0, 4).bind() != 0 // 다섯에 하나는 좌표를 모른다
                plannedSlot(
                    date, 0, begin, until,
                    lat = if (placed) 33.45 else null, lng = if (placed) 126.56 else null,
                    endsNextDay = until < begin,
                )
            },
            0..20,
        ).bind()
        // 날짜마다 방문 순서를 무작위 순열로 매긴다 — 저장 순서로 보내면 이 성질이 깨진다.
        val keys = raw.map { Arb.int().bind() }
        raw.indices.groupBy { raw[it].date }.values.flatMap { idx ->
            idx.sortedBy { keys[it] }.mapIndexed { order, i -> i to raw[i].copy(orderIndex = order) }
        }.sortedBy { it.first }.map { it.second }
    }

    fun endedAt(s: PlannedSlotView, today: LocalDate, time: LocalTime) =
        s.date < today || (s.date == today && !s.endsNextDay && s.endAt <= time)

    "PBT-SA-20 보낸 슬롯은 그 날짜·좌표 있음·끝나지 않음이고, 방문 순서 앞에서부터 8개까지다" {
        checkAll(slotsArb, Arb.element(days), Arb.int(0, 23), Arb.int(0, 59), Arb.int(0, 4)) { slots, today, hour, minute, ahead ->
            val time = LocalTime.of(hour, minute)
            val date = minOf(today.plusDays(ahead.toLong()), end)
            val port = RecordingOpportunityPort()

            OpportunityService(
                OpportunityTrips(owner, tripId, TripPeriod(start, end)), OpportunityPlans(slots),
                opportunityPorts(port), kstClock(today, time),
            ).list(owner, tripId, date)

            val eligible = slots.filter { it.date == date && it.lat != null && it.lng != null && !endedAt(it, today, time) }
            if (eligible.isEmpty()) {
                port.queries.shouldBeEmpty() // 빈 재료로 묻지 않는다
            } else {
                val query = port.queries.single()
                val byKey = slots.associateBy { it.slotKey }
                val sent = query.slots.map { byKey.getValue(it.slotKey) }
                query.date shouldBe date
                sent.size shouldBeLessThanOrEqual 8
                sent.forEach { s ->
                    s.date shouldBe date
                    endedAt(s, today, time) shouldBe false
                    (s.lat != null && s.lng != null) shouldBe true
                }
                sent.shouldBeSortedWith(compareBy { it.orderIndex })
                // 앞에서부터다 — 보낸 것보다 순서가 앞선 자격 칸을 건너뛰지 않았고, 8개가 안 되면 자격 칸 전부다.
                val skipped = eligible.filter { e -> sent.none { it.slotKey == e.slotKey } }
                if (sent.size < 8) skipped.shouldBeEmpty()
                skipped.forEach { (it.orderIndex > sent.last().orderIndex) shouldBe true }
                // 계획 POI 는 일정 전체의 장소다(300 미만이면 빠짐없이).
                query.plannedPoiIds.toSet() shouldBe slots.map { it.poiId }.toSet()
            }
        }
    }

    "PBT-SA-20 여행 전·지난 날짜·종료 뒤 날짜는 AI 를 부르지 않는다" {
        val probe = days.flatMap { d -> (0..3).map { plannedSlot(d, it, LocalTime.of(10 + it, 0), LocalTime.of(10 + it, 30)) } }
        checkAll(Arb.int(-3, 7), Arb.int(-3, 7), Arb.int(0, 23)) { todayOffset, dateOffset, hour ->
            val today = start.plusDays(todayOffset.toLong())
            val date = start.plusDays(dateOffset.toLong())
            val outside = today < start || date < today || date > end
            val port = RecordingOpportunityPort()

            val out = OpportunityService(
                OpportunityTrips(owner, tripId, TripPeriod(start, end)), OpportunityPlans(probe + listOf(
                    plannedSlot(start.minusDays(3), 0, LocalTime.of(23, 0), LocalTime.of(23, 30)),
                    plannedSlot(end.plusDays(3), 0, LocalTime.of(23, 0), LocalTime.of(23, 30)),
                )),
                opportunityPorts(port), kstClock(today, LocalTime.of(hour, 0)),
            ).list(owner, tripId, date)

            if (outside) {
                port.queries.shouldBeEmpty()
                out.shouldBeEmpty()
            }
        }
    }

    "PBT-SA-20 임의 AI 응답에도 출력은 계약을 지키고, 멀쩡한 답은 그대로 낸다" {
        checkAll(Arb.int(1, 10), Arb.list(Arb.enum<OpportunityKind>(), 0..3), Arb.list(Arb.int(0, 9), 3..3), Arb.enum<Fault>()) {
                slotCount, kinds, picks, fault ->
            val today = days[1]
            val slots = (0 until slotCount).map { plannedSlot(today, it, LocalTime.of(13, it), LocalTime.of(14, it)) } +
                plannedSlot(today.plusDays(1), 0, LocalTime.of(9, 0), LocalTime.of(10, 0))
            lateinit var built: List<Opportunity>
            val port = RecordingOpportunityPort { q ->
                built = kinds.mapIndexed { i, kind -> card(q, kind, nearIndex = picks[i]) }
                OpportunityReply(fault.apply(built, q), emptyList())
            }

            val out = OpportunityService(
                OpportunityTrips(owner, tripId, TripPeriod(start, end)), OpportunityPlans(slots),
                opportunityPorts(port), kstClock(today, LocalTime.of(12, 0)),
            ).list(owner, tripId, today)

            val query = port.queries.single()
            honorsContract(out, query) shouldBe true
            // 결함을 넣었으면(넣을 자리가 있었다면) 답 전체가 빠지고, 안 넣었으면 받은 그대로다.
            if (fault.breaks(built)) out.shouldBeEmpty() else out shouldBe built
        }
    }
}) {
    /** AI 답에 넣는 결함 한 가지 — 하나하나가 계약·BR-SA-22 위반이다. */
    private enum class Fault {
        NONE, TOO_MANY, UNSENT_SLOT, PLANNED_POI, SLOT_POI, SAME_POI, SAME_KEY, NO_EVENT_NAME, NO_END, PAST_EVENT, BLANK_LABEL;

        /** 이 결함을 넣을 자리가 있었는가(항목이 없으면 항목 결함은 들어가지 않는다). */
        fun breaks(items: List<Opportunity>): Boolean = when (this) {
            NONE -> false
            TOO_MANY -> true
            NO_EVENT_NAME, NO_END, PAST_EVENT -> items.any { it.kind != OpportunityKind.TRENDING }
            else -> items.isNotEmpty()
        }

        fun apply(items: List<Opportunity>, q: OpportunityQuery): List<Opportunity> {
            val first = items.firstOrNull()
            val event = items.indexOfFirst { it.kind != OpportunityKind.TRENDING }
            fun replaceEvent(f: (Opportunity) -> Opportunity) =
                if (event < 0) items else items.toMutableList().also { it[event] = f(it[event]) }
            return when (this) {
                NONE -> items
                TOO_MANY -> items + (items.size until 4).map { card(q, OpportunityKind.TRENDING, nearIndex = it) }
                UNSENT_SLOT -> items.map { it.copy(nearSlotKey = "${q.date}#${UUID.randomUUID()}") }
                PLANNED_POI -> first?.let { listOf(it.copy(poiId = q.plannedPoiIds.last())) + items.drop(1) } ?: items
                SLOT_POI -> first?.let { listOf(it.copy(poiId = q.slots.first().poiId)) + items.drop(1) } ?: items
                SAME_POI -> first?.let { items + it.copy(key = "${it.key}-again") } ?: items
                SAME_KEY -> first?.let { items + it.copy(poiId = UUID.randomUUID()) } ?: items
                NO_EVENT_NAME -> replaceEvent { it.copy(eventName = null) }
                NO_END -> replaceEvent { it.copy(end = null) }
                PAST_EVENT -> replaceEvent { it.copy(start = q.date.minusDays(3), end = q.date.minusDays(1)) }
                BLANK_LABEL -> items.map { it.copy(distanceLabel = "") }
            }
        }
    }

    private companion object {
        /** 질의에 맞는 멀쩡한 카드 한 장 — 장소는 새것(일정 밖), 슬롯은 보낸 것, 행사면 그 날을 덮는 기간. */
        fun card(q: OpportunityQuery, kind: OpportunityKind, nearIndex: Int): Opportunity {
            val poi = UUID.randomUUID()
            val near = q.slots[nearIndex % q.slots.size].slotKey
            return if (kind == OpportunityKind.TRENDING) {
                Opportunity("trending:$poi", kind, null, null, null, poi, "요즘 뜨는 카페", near, "약 300m")
            } else {
                Opportunity("event:tourapi-$poi", kind, "제주 들불축제", q.date.minusDays(1), q.date.plusDays(2), poi, "새별오름", near, "약 1.0km")
            }
        }

        /** 앱 계약(openapi `OpportunityList`)과 BR-SA-22 — 출력 쪽에서 본 성질이다. */
        fun honorsContract(out: List<Opportunity>, q: OpportunityQuery): Boolean {
            val sent = q.slots.map { it.slotKey }.toSet()
            val planned = q.plannedPoiIds.toSet() + q.slots.map { it.poiId }
            return out.size <= 3 &&
                out.map { it.key }.distinct().size == out.size &&
                out.map { it.poiId }.distinct().size == out.size &&
                out.all { o ->
                    o.key.isNotBlank() && o.poiName.isNotBlank() && o.distanceLabel.isNotBlank() &&
                        o.nearSlotKey in sent && o.poiId !in planned &&
                        (o.kind == OpportunityKind.TRENDING || (!o.eventName.isNullOrBlank() && o.start != null && o.end != null && q.date in o.start..o.end))
                }
        }
    }
}
