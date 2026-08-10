package com.trippilot.itinerarygeneration.application

import com.trippilot.core.error.ConflictDetected
import com.trippilot.core.error.ResourceNotFound
import com.trippilot.core.error.ValidationFailed
import com.trippilot.core.error.UpstreamUnavailable
import com.trippilot.itinerarygeneration.domain.ScheduleAgentCallFailed
import com.trippilot.itinerarygeneration.domain.GenerationMode
import com.trippilot.itinerarygeneration.domain.FreshnessMeta
import com.trippilot.itinerarygeneration.domain.Itinerary
import com.trippilot.itinerarygeneration.domain.ItineraryDay
import com.trippilot.itinerarygeneration.domain.ItineraryRepository
import com.trippilot.itinerarygeneration.domain.SlotCandidate
import com.trippilot.itinerarygeneration.domain.SlotCandidatesInput
import com.trippilot.itinerarygeneration.domain.SlotCandidatesOutput
import com.trippilot.itinerarygeneration.domain.SolveMode
import com.trippilot.itinerarygeneration.domain.VisitSlot
import com.trippilot.placedata.api.Area
import com.trippilot.placedata.api.CandidatePoolPort
import com.trippilot.placedata.api.FrozenPoiView
import com.trippilot.placedata.api.GroundedPlace
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

    val itinerary = Itinerary.create(tripId, SolveMode.FULL_AI, GenerationMode.FULLY_AI, false,
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

    class CapturingAgent(private val failure: ScheduleAgentCallFailed? = null) : StubScheduleAgent() {
        var captured: SlotCandidatesInput? = null
        override fun proposeSlotCandidates(input: SlotCandidatesInput): SlotCandidatesOutput {
            captured = input
            failure?.let { throw it }
            return SlotCandidatesOutput(
                listOf(SlotCandidate(UUID.randomUUID(), "약 1.1km", "주변 카페")),
                radiusMUsed = 12_000,
                freshness = FreshnessMeta(Instant.parse("2026-08-06T00:00:00Z"), false),
            )
        }
    }

    // 후보가 정본에 실재하는지 다시 확인하는 경로(INV-1) — 테스트는 전부 통과시키되 호출은 관측한다.
    val pool = object : CandidatePoolPort {
        var grounded = 0
        override fun resolve(area: Area, categories: Set<String>) = emptyList<GroundedPlace>()
        override fun ground(poiIds: List<UUID>): List<GroundedPlace> {
            grounded++
            return poiIds.map { GroundedPlace(it, "장소", 33.45, 126.56, "명소", null, null) }
        }
    }

    fun service(agent: CapturingAgent, stored: Itinerary? = itinerary) =
        SlotCandidateService(trips, Repo(stored), agent, surfaces, pool, clock)

    "경계가 실패하면 503 으로 표면화한다 — 500(우리가 터졌다)이 아니다" {
        // http 모드에서 이 경로는 아직 미개통이라 어댑터가 SLOT_CANDIDATES_NOT_WIRED 를 던진다.
        // 감싸지 않으면 RuntimeException 이라 전역 핸들러가 500 으로 떨구는데, 사실은 "지금은 못 준다"다.
        val down = CapturingAgent(
            ScheduleAgentCallFailed("SLOT_CANDIDATES_NOT_WIRED", retryable = false, message = "미개통"),
        )
        val e = shouldThrow<UpstreamUnavailable> {
            service(down).propose(acc, tripId, RequestSlotCandidates(SlotKey.of(d1, target), null, null))
        }
        e.source shouldBe "schedule-agent"
        // 후보는 지어낼 수 없다(INV-1) — 빈 목록으로 접으면 "주변에 없음"과 구분되지 않는다.
        e.fallbackApplied shouldBe false
    }

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

    "반경 상한을 넘으면 400 — 상한 없이 두면 전 DB 스캔이 된다" {
        shouldThrow<ValidationFailed> {
            service(CapturingAgent()).propose(
                acc, tripId, RequestSlotCandidates(SlotKey.of(d1, target), Int.MAX_VALUE, null),
            )
        }
    }

    "확정된 일정에는 후보를 제안하지 않는다 — 골라도 편집이 막힌다" {
        val confirmed = itinerary.confirm(
            itinerary.days.flatMap { it.slots }.associate { it.sourcePoiId to UUID.randomUUID() }, now,
        )
        shouldThrow<ConflictDetected> {
            service(CapturingAgent(), stored = confirmed).propose(acc, tripId, RequestSlotCandidates(SlotKey.of(d1, target), null, null))
        }
    }

    "같은 날 같은 장소가 둘이면 어느 슬롯인지 특정할 수 없어 409" {
        val dup = Itinerary.create(
            tripId, SolveMode.FULL_AI, GenerationMode.FULLY_AI, false,
            listOf(ItineraryDay.of(d1, 0, listOf(slot(target, 0, "09:00"), slot(target, 1, "18:00")))),
            now,
        )
        shouldThrow<ConflictDetected> {
            service(CapturingAgent(), stored = dup).propose(acc, tripId, RequestSlotCandidates(SlotKey.of(d1, target), null, null))
        }
    }

    "후보는 정본에 실재하는지 다시 확인한다(INV-1 closed-set)" {
        // 스펙 스코프에서 pool 을 공유하므로 증분으로 본다.
        val before = pool.grounded
        service(CapturingAgent()).propose(acc, tripId, RequestSlotCandidates(SlotKey.of(d1, target), null, null))
        pool.grounded shouldBe before + 1
    }
})
