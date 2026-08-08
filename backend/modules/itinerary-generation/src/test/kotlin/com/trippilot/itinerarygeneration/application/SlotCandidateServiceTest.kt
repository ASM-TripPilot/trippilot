package com.trippilot.itinerarygeneration.application

import com.trippilot.core.error.ResourceNotFound
import com.trippilot.core.error.ValidationFailed
import com.trippilot.itinerarygeneration.domain.FreshnessMeta
import com.trippilot.itinerarygeneration.domain.Itinerary
import com.trippilot.itinerarygeneration.domain.ItineraryDay
import com.trippilot.itinerarygeneration.domain.ItineraryRepository
import com.trippilot.itinerarygeneration.domain.SlotCandidate
import com.trippilot.itinerarygeneration.domain.SlotCandidatesInput
import com.trippilot.itinerarygeneration.domain.SlotCandidatesOutput
import com.trippilot.itinerarygeneration.domain.SolveMode
import com.trippilot.itinerarygeneration.domain.VisitSlot
import com.trippilot.placedata.api.FrozenPoiView
import com.trippilot.placedata.api.PoiSurfaceFacade
import com.trippilot.placedata.api.PoiSurfaceView
import com.trippilot.trip.api.TripFacade
import com.trippilot.trip.api.TripPeriod
import io.kotest.assertions.throwables.shouldThrow
import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.collections.shouldContainExactly
import io.kotest.matchers.shouldBe
import java.time.Clock
import java.time.Instant
import java.time.LocalDate
import java.time.LocalTime
import java.time.ZoneOffset
import java.util.UUID

/**
 * 슬롯 후보 제안(TRIP-311 · DEC-U3-5).
 * 핵심은 **제외 목록을 서버가 만든다**는 것 — 클라이언트 값을 믿으면 이미 일정에 있는 장소가 재추천된다(BR-U3-24).
 */
class SlotCandidateServiceTest : StringSpec({

    val now = Instant.parse("2026-08-06T00:00:00Z")
    val clock = Clock.fixed(now, ZoneOffset.UTC)
    val acc = UUID.randomUUID()
    val tripId = UUID.randomUUID()
    val d1 = LocalDate.parse("2026-08-01")
    val target = UUID.randomUUID()
    val neighborBefore = UUID.randomUUID()
    val neighborAfter = UUID.randomUUID()

    fun slot(poi: UUID, order: Int, start: String) =
        VisitSlot.of(poi, null, order, LocalTime.parse(start), LocalTime.parse(start).plusHours(1))

    val itinerary = Itinerary.create(
        tripId, SolveMode.FULL_AI, false,
        listOf(
            ItineraryDay.of(
                d1, 0,
                listOf(slot(neighborBefore, 0, "09:00"), slot(target, 1, "11:00"), slot(neighborAfter, 2, "13:00")),
            ),
        ),
        now,
    )

    class Repo(private val stored: Itinerary?) : ItineraryRepository {
        override fun save(itinerary: Itinerary) = itinerary
        override fun findById(itineraryId: UUID) = stored
        override fun findByTrip(tripId: UUID) = listOfNotNull(stored)
        override fun replaceForTrip(tripId: UUID, itinerary: Itinerary) = itinerary
        override fun replaceIfCurrent(tripId: UUID, expectedItineraryId: UUID, itinerary: Itinerary) = true
        override fun findStalePartial(updatedBefore: Instant) = emptyList<Itinerary>()
    }

    val surfaces = object : PoiSurfaceFacade {
        override fun findSurfaces(poiIds: Collection<UUID>) = poiIds.associateWith {
            PoiSurfaceView(it, "장소", 33.45, 126.56, "명소", null, null, emptyList())
        }
        override fun findFrozenSurfaces(poiSnapshotIds: Collection<UUID>) = emptyMap<UUID, FrozenPoiView>()
    }

    val trips = object : TripFacade {
        override fun findPeriod(accountId: UUID, tripId: UUID) = if (accountId == acc) TripPeriod(d1, d1) else null
        override fun findGenerationContext(accountId: UUID, tripId: UUID) = null
    }

    class CapturingAgent : StubScheduleAgent() {
        var captured: SlotCandidatesInput? = null
        override fun proposeSlotCandidates(input: SlotCandidatesInput): SlotCandidatesOutput {
            captured = input
            return SlotCandidatesOutput(
                listOf(SlotCandidate(UUID.randomUUID(), "약 1.1km", "주변 카페")),
                radiusMUsed = 12_000,
                freshness = FreshnessMeta(Instant.parse("2026-08-06T00:00:00Z"), false),
            )
        }
    }

    fun service(agent: CapturingAgent, stored: Itinerary? = itinerary) =
        SlotCandidateService(trips, Repo(stored), agent, surfaces, clock)

    "이미 일정에 있는 장소를 서버가 제외 목록으로 만든다(BR-U3-24)" {
        val agent = CapturingAgent()
        service(agent).propose(acc, tripId, RequestSlotCandidates(SlotKey.of(d1, target), null, null))

        // 클라이언트는 제외 목록을 보내지 않는다 — 서버가 현재 일정 전체에서 유도한다
        agent.captured!!.excludePoiIds.toSet() shouldBe setOf(neighborBefore, target, neighborAfter)
    }

    "직전·직후 슬롯을 이웃으로 넘긴다(동선 트레이드오프 입력)" {
        val agent = CapturingAgent()
        service(agent).propose(acc, tripId, RequestSlotCandidates(SlotKey.of(d1, target), null, null))

        agent.captured!!.neighborSlotKeys shouldContainExactly
            listOf(SlotKey.of(d1, neighborBefore), SlotKey.of(d1, neighborAfter))
    }

    "첫 슬롯이면 이웃이 하나뿐이다" {
        val agent = CapturingAgent()
        service(agent).propose(acc, tripId, RequestSlotCandidates(SlotKey.of(d1, neighborBefore), null, null))
        agent.captured!!.neighborSlotKeys shouldContainExactly listOf(SlotKey.of(d1, target))
    }

    "반경·컨셉은 그대로 전달하고, 실제 사용 반경은 응답값을 쓴다(BR-U3-25)" {
        val agent = CapturingAgent()
        val out = service(agent).propose(acc, tripId, RequestSlotCandidates(SlotKey.of(d1, target), 3_000, "감성"))

        agent.captured!!.radiusM shouldBe 3_000
        agent.captured!!.concept shouldBe "감성"
        out.radiusMUsed shouldBe 12_000 // AI 가 넓힌 값 — 요청값이 아니라 응답값을 노출한다
    }

    "슬롯 키 형식이 틀리면 400" {
        shouldThrow<ValidationFailed> {
            service(CapturingAgent()).propose(acc, tripId, RequestSlotCandidates("이상한키", null, null))
        }
    }

    "타 계정·없는 일정·없는 슬롯은 404" {
        shouldThrow<ResourceNotFound> {
            service(CapturingAgent()).propose(UUID.randomUUID(), tripId, RequestSlotCandidates(SlotKey.of(d1, target), null, null))
        }
        shouldThrow<ResourceNotFound> {
            service(CapturingAgent(), stored = null).propose(acc, tripId, RequestSlotCandidates(SlotKey.of(d1, target), null, null))
        }
        shouldThrow<ResourceNotFound> {
            service(CapturingAgent()).propose(acc, tripId, RequestSlotCandidates(SlotKey.of(d1, UUID.randomUUID()), null, null))
        }
    }
})
