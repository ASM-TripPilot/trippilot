package com.trippilot.assistant.application

import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.ObjectMapper
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule
import com.fasterxml.jackson.module.kotlin.kotlinModule
import com.trippilot.assistant.domain.AssistantSurface
import com.trippilot.itinerarygeneration.api.ItineraryFacade
import com.trippilot.itinerarygeneration.api.ItineraryPlanFacade
import com.trippilot.itinerarygeneration.api.ItineraryRef
import com.trippilot.itinerarygeneration.api.PlannedPlaceView
import com.trippilot.profile.api.PreferenceFacade
import com.trippilot.profile.api.PreferenceSnapshot
import com.trippilot.savedaccommodation.api.DayBaseStayView
import com.trippilot.savedaccommodation.api.TripBaseStayFacade
import com.trippilot.trip.api.TripDestinationRef
import com.trippilot.trip.api.TripFacade
import com.trippilot.trip.api.TripGenerationContext
import com.trippilot.trip.api.TripPeriod
import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.collections.shouldContainExactly
import io.kotest.matchers.shouldBe
import io.kotest.matchers.string.shouldNotContain
import io.kotest.property.Arb
import io.kotest.property.arbitrary.element
import io.kotest.property.arbitrary.int
import io.kotest.property.arbitrary.list
import io.kotest.property.arbitrary.stringPattern
import io.kotest.property.checkAll
import java.time.LocalDate
import java.util.UUID

/**
 * 컨텍스트 스냅샷(FD §5 · BR-U8-22 · SEC-U8-08). **이 스냅샷이 권한 경계다** — 프롬프트에 "보여 주지 마"를 부탁하는 것이
 * 아니라, 싣지 않는다.
 */
class ContextSnapshotBuilderTest : StringSpec({

    val today = LocalDate.parse("2026-11-02")
    val json = ObjectMapper().registerModule(kotlinModule()).registerModule(JavaTimeModule())

    /** 여행은 주인만 읽을 수 있다 — 실 퍼사드와 같은 규칙. */
    fun trips(owner: UUID, tripId: UUID, region: String, days: Long = 2) = object : TripFacade {
        override fun findPeriod(accountId: UUID, id: UUID): TripPeriod? = null
        override fun findGenerationContext(accountId: UUID, id: UUID) =
            if (accountId == owner && id == tripId) {
                TripGenerationContext(today.minusDays(1), today.minusDays(1).plusDays(days), listOf(TripDestinationRef(region, null, days.toInt())), "친구", 900_000, emptyList())
            } else {
                null
            }
    }
    fun stays(name: String?) = object : TripBaseStayFacade {
        override fun findBaseStays(tripId: UUID, startDate: LocalDate, endDate: LocalDate) =
            listOfNotNull(name?.let { DayBaseStayView(startDate, UUID.randomUUID(), it) })
    }
    fun builder(trips: TripFacade, stays: TripBaseStayFacade, data: FakeTripData, properties: AssistantProperties = AssistantProperties()) =
        ContextSnapshotBuilder(TripContextReader(trips, stays), data, data, properties)

    /** 직렬형의 모든 키(중첩 포함). */
    fun keys(node: JsonNode): Set<String> = when {
        node.isObject -> node.fieldNames().asSequence().toSet() + node.elements().asSequence().flatMap { keys(it) }
        node.isArray -> node.elements().asSequence().flatMap { keys(it) }.toSet()
        else -> emptySet()
    }
    val whitelist = setOf(
        "surface", "trip", "baseStays", "itinerary", // 블록
        "tripId", "regions", "startDate", "endDate", "phase", // trip
        "status", "days", "date", "slots", // itinerary
        "slotKey", "name", "startAt", "category", // slot
        "tastes", "styles", "activities", // 계정 취향 — 지역 추천이 쓰는 두 축만
    )

    fun prefs(owner: UUID, styles: List<String>, activities: List<String>) = object : PreferenceFacade {
        override fun findPreferences(accountId: UUID) = if (accountId == owner) {
            PreferenceSnapshot(styles, activities, listOf("한식"), listOf("대중교통"), "여유", listOf("친구"), true, "중간")
        } else {
            PreferenceSnapshot(emptyList(), emptyList(), emptyList(), emptyList(), null, emptyList(), false, null)
        }
    }

    "계정 취향은 두 축(styles·activities)만 실리고, 고른 게 없으면 싣지 않는다 — 여행이 없어도 실린다" {
        val acc = UUID.randomUUID()
        val b = ContextSnapshotBuilder(
            TripContextReader(trips(acc, UUID.randomUUID(), "부산"), stays(null)), FakeTripData(acc), FakeTripData(acc), AssistantProperties(),
            prefs(acc, listOf("자연"), listOf("카페")),
        )
        val mine = b.build(acc, null, AssistantSurface.HOME, today)
        mine.tastes shouldBe com.trippilot.assistant.domain.ContextSnapshot.Tastes(listOf("자연"), listOf("카페"))
        val wire = json.writeValueAsString(mine)
        listOf("한식", "대중교통", "여유", "친구", "중간").forEach { wire shouldNotContain it } // 다른 축은 실을 자리가 없다
        (keys(json.readTree(wire)) - whitelist) shouldBe emptySet()
        b.build(UUID.randomUUID(), null, AssistantSurface.HOME, today).tastes shouldBe null // 고른 게 없다
    }

    "여행·숙소·일정이 화이트리스트 필드만으로 실린다" {
        val (acc, tripId) = UUID.randomUUID() to UUID.randomUUID()
        val slot = plannedSlot(today, 0, "14:00", "카페 모카", violation = "영업시간과 맞지 않아요", distance = "840m")
        val snapshot = builder(trips(acc, tripId, "부산"), stays("서면 호텔"), FakeTripData(acc, slots = listOf(slot)))
            .build(acc, tripId, AssistantSurface.ITINERARY, today)

        snapshot.trip!!.let { listOf(it.tripId, it.regions, it.phase) } shouldContainExactly listOf(tripId, listOf("부산"), "IN_TRIP")
        snapshot.baseStays shouldContainExactly listOf("서면 호텔")
        snapshot.itinerary!!.status shouldBe "PLANNED"
        snapshot.itinerary!!.days.single().slots.single().let { listOf(it.slotKey, it.name, it.startAt.toString(), it.category) } shouldContainExactly
            listOf(slot.slotKey, "카페 모카", "14:00", "카페")
        // 위반 사유·거리·좌표·예산·동행은 실을 자리가 없다
        val wire = json.writeValueAsString(snapshot)
        listOf("영업시간과", "840m", "900000", "친구", "lat", "lng", "hasViolation").forEach { wire shouldNotContain it }
        (keys(json.readTree(wire)) - whitelist) shouldBe emptySet()
    }

    "여행이 없거나 남의 여행이면 화면 값만 간다" {
        val (acc, tripId) = UUID.randomUUID() to UUID.randomUUID()
        val b = builder(trips(acc, tripId, "부산"), stays("서면 호텔"), FakeTripData(acc, slots = listOf(plannedSlot(today, 0, "14:00", "카페"))))

        listOf(b.build(acc, null, AssistantSurface.HOME, today), b.build(UUID.randomUUID(), tripId, AssistantSurface.HOME, today)).forEach {
            it.trip shouldBe null
            it.baseStays shouldBe emptyList()
            it.itinerary shouldBe null
        }
    }

    /**
     * PBT-U8-3 — 임의의 두 계정과 임의의 여행 데이터에 대해, A 의 스냅샷에 **B 의 여행·숙소·슬롯 id·이름이 나타나지 않고**
     * 키 집합은 화이트리스트 안이다. A 가 B 의 여행 id 를 들고 와도 마찬가지다.
     *
     * 두 계정의 데이터가 **한 저장소에** 있다 — 읽기를 계정으로 가르는 것은 퍼사드고, 숙소 읽기는 여행 id 만 받는다.
     * 그래서 빌더가 소유 확인보다 먼저 숙소·일정을 읽으면 B 의 것이 그대로 나온다. 그 순서가 경계다.
     */
    "임의의 두 계정에서 남의 여행·숙소·슬롯이 스냅샷에 실리지 않는다" {
        val name = Arb.stringPattern("[가-힣]{3,6}")
        checkAll(60, Arb.list(name, 1..5), Arb.list(name, 1..5), name, name, Arb.element(true, false)) { mine, theirs, myRegion, theirRegion, probeTheirTrip ->
            val (a, b) = UUID.randomUUID() to UUID.randomUUID()
            val (tripA, tripB) = UUID.randomUUID() to UUID.randomUUID()
            val slotsOf = mapOf(
                tripA to mine.mapIndexed { i, n -> plannedSlot(today, i, "1$i:00", n) },
                tripB to theirs.mapIndexed { i, n -> plannedSlot(today, i, "1$i:00", "남의-$n") },
            )
            val ownerOf = mapOf(tripA to a, tripB to b)
            val tripFacade = object : TripFacade {
                override fun findPeriod(accountId: UUID, id: UUID): TripPeriod? = null
                override fun findGenerationContext(accountId: UUID, id: UUID) =
                    trips(a, tripA, myRegion).findGenerationContext(accountId, id) ?: trips(b, tripB, "남의-$theirRegion").findGenerationContext(accountId, id)
            }
            // 숙소는 여행 id 만으로 읽힌다(실 퍼사드가 그렇다) — 남의 여행 id 로 물으면 남의 숙소가 나온다
            val stayFacade = object : TripBaseStayFacade {
                override fun findBaseStays(tripId: UUID, startDate: LocalDate, endDate: LocalDate) =
                    listOf(DayBaseStayView(startDate, UUID.randomUUID(), if (tripId == tripB) "남의-숙소" else "내 숙소"))
            }
            // 일정은 (계정, 여행)으로 읽힌다
            val itineraryFacade = object : ItineraryFacade, ItineraryPlanFacade {
                override fun findCurrent(accountId: UUID, tripId: UUID) =
                    slotsOf[tripId]?.takeIf { ownerOf[tripId] == accountId }?.let { ItineraryRef(UUID.randomUUID(), "PLANNED", "COMPLETE", listOf(today), it.map { s -> s.slotKey }) }
                override fun findPlanSlots(accountId: UUID, tripId: UUID) = slotsOf[tripId]?.takeIf { ownerOf[tripId] == accountId }.orEmpty()
                override fun findPlannedPlaces(accountId: UUID, tripId: UUID) = emptyMap<LocalDate, List<PlannedPlaceView>>()
            }

            val snapshot = ContextSnapshotBuilder(TripContextReader(tripFacade, stayFacade), itineraryFacade, itineraryFacade, AssistantProperties())
                .build(a, if (probeTheirTrip) tripB else tripA, AssistantSurface.ITINERARY, today)
            val wire = json.writeValueAsString(snapshot)

            (keys(json.readTree(wire)) - whitelist) shouldBe emptySet()
            wire shouldNotContain tripB.toString()
            wire shouldNotContain "남의-"
            slotsOf.getValue(tripB).forEach { wire shouldNotContain it.poiId.toString() }
            if (probeTheirTrip) {
                snapshot shouldBe com.trippilot.assistant.domain.ContextSnapshot(AssistantSurface.ITINERARY, null, emptyList(), null)
            } else {
                snapshot.itinerary!!.days.single().slots.map { it.name } shouldContainExactly mine // 자기 것은 온다 — 빈 스냅샷으로 통과하는 것이 아니다
                snapshot.baseStays shouldContainExactly listOf("내 숙소")
            }
        }
    }

    /** SEC-U8-08 — 양도 줄인다. 입력 토큰이 곧 비용이고 지연이다. */
    "일정이 상한을 넘으면 오늘 ±1일만 보낸다 — 상한 안이면 전부 보낸다" {
        val (acc, tripId) = UUID.randomUUID() to UUID.randomUUID()
        checkAll(40, Arb.int(1..6), Arb.int(1..5), Arb.element(-1L, 3L, -9L)) { dayCount, perDay, offset ->
            // 오늘이 일정 안(어제 시작) · 일정 전(사흘 뒤 시작) · 일정 후(아흐레 전 시작)
            val start = today.plusDays(offset)
            val slots = (0 until dayCount).flatMap { d -> (0 until perDay).map { i -> plannedSlot(start.plusDays(d.toLong()), i, "1$i:00", "곳$d-$i") } }
            val days = builder(
                trips(acc, tripId, "부산", days = dayCount.toLong() - 1), stays(null), FakeTripData(acc, slots = slots),
                AssistantProperties(snapshotMaxDays = 3, snapshotMaxSlotsPerDay = 3),
            ).build(acc, tripId, AssistantSurface.ITINERARY, today).itinerary!!.days

            if (dayCount <= 3 && perDay <= 3) {
                days.map { it.date } shouldContainExactly (0 until dayCount).map { start.plusDays(it.toLong()) }
                days.forEach { it.slots.size shouldBe perDay }
            } else {
                // 오늘이 일정 기간 밖이면 첫 날이 기준이다 — 여행 전에 긴 일정을 놓고 말하는 경우
                val pivot = if (today in start..start.plusDays(dayCount - 1L)) today else start
                days.map { it.date } shouldContainExactly listOf(pivot.minusDays(1), pivot, pivot.plusDays(1)).filter { d -> slots.any { it.date == d } }
                days.forEach { (it.slots.size <= 3) shouldBe true }
            }
        }
    }
})
