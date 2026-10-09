package com.trippilot.itinerarygeneration.application

import com.trippilot.trip.api.TripGenerationContext
import com.trippilot.itinerarygeneration.domain.PersonalizationHints
import com.trippilot.itinerarygeneration.domain.PersonalizationPort
import com.trippilot.profile.api.PreferenceSnapshot
import com.trippilot.profile.api.PreferenceFacade
import com.trippilot.core.error.ConflictDetected
import com.trippilot.core.error.ResourceNotFound
import com.trippilot.core.error.ValidationFailed
import com.trippilot.core.error.UpstreamUnavailable
import com.trippilot.itinerarygeneration.domain.ScheduleAgentCallFailed
import com.trippilot.itinerarygeneration.domain.GenerationMode
import com.trippilot.itinerarygeneration.domain.GenerationState
import com.trippilot.itinerarygeneration.domain.FreshnessMeta
import com.trippilot.itinerarygeneration.domain.Itinerary
import com.trippilot.itinerarygeneration.domain.ItineraryDay
import com.trippilot.itinerarygeneration.domain.ItineraryRepository
import com.trippilot.itinerarygeneration.domain.ScoredCandidate
import com.trippilot.itinerarygeneration.domain.ScoredCandidatePool
import com.trippilot.itinerarygeneration.domain.ScoredCandidatePoolStore
import com.trippilot.itinerarygeneration.domain.SlotCandidate
import com.trippilot.itinerarygeneration.domain.SlotCandidatesEmptyReason
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
import io.kotest.matchers.shouldNotBe
import io.kotest.property.Arb
import io.kotest.property.arbitrary.int
import io.kotest.property.arbitrary.list
import io.kotest.property.checkAll
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
            PoiSurfaceView(it, "장소", 33.45, 126.56, "명소", "SIGHT", null, null, emptyList())
        }
        override fun findFrozenSurfaces(poiSnapshotIds: Collection<UUID>) = emptyMap<UUID, FrozenPoiView>()
    }

    val trips = object : TripFacade {
        override fun findPeriod(accountId: UUID, tripId: UUID) = if (accountId == acc) TripPeriod(d1, d1) else null
        override fun findGenerationContext(accountId: UUID, tripId: UUID) = null
    }

    // 계정 취향 = 액티비티. 여행 스냅숏이 있으면 그쪽이 이겨야 한다(BR-U1-38).
    val accountPrefs = object : PreferenceFacade {
        override fun findPreferences(accountId: UUID) = PreferenceSnapshot(
            listOf("액티비티"), emptyList(), emptyList(), listOf("대중교통"), null, listOf("혼자"), false, "저가",
        )
    }
    val NoHints = object : PersonalizationPort {
        override fun hintsFor(accountId: UUID) = PersonalizationHints.NONE
    }

    class CapturingAgent(
        private val failure: ScheduleAgentCallFailed? = null,
        /** true 면 0건 응답 — 즉답 구제(TRIP-969 "전개가 저장분보다 나쁘면") 검증용. */
        private val respondEmpty: Boolean = false,
    ) : StubScheduleAgent() {
        var captured: SlotCandidatesInput? = null
        override fun proposeSlotCandidates(input: SlotCandidatesInput): SlotCandidatesOutput {
            captured = input
            failure?.let { throw it }
            return SlotCandidatesOutput(
                if (respondEmpty) emptyList() else listOf(SlotCandidate(UUID.randomUUID(), "약 1.1km", "주변 카페")),
                radiusMUsed = 12_000,
                freshness = FreshnessMeta(Instant.parse("2026-08-06T00:00:00Z"), false),
                emptyReason = if (respondEmpty) SlotCandidatesEmptyReason.NO_NEARBY else null,
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

    fun service(
        agent: CapturingAgent,
        stored: Itinerary? = itinerary,
        scored: ScoredCandidatePoolStore = FakeScoredCandidatePoolStore(), // 기본 빈 풀 — 종전 경로 그대로
        candidates: CandidatePoolPort = pool,
        tripFacade: TripFacade = trips,
    ) = SlotCandidateService(tripFacade, Repo(stored), agent, surfaces, candidates, scored, clock, accountPrefs, NoHints)

    "경계가 실패하면 503 으로 표면화한다 — 500(우리가 터졌다)이 아니다" {
        // 감싸지 않으면 RuntimeException 이라 전역 핸들러가 500 으로 떨구는데, 사실은 "지금은 못 준다"다.
        // (예전에는 SLOT_CANDIDATES_NOT_WIRED 가 이 자리였다. 이제 http 모드는 로컬 후보로 답하므로
        //  실제로 남는 실패는 타임아웃·연결 불가 같은 것이다 — 매핑 규칙은 그대로다.)
        val down = CapturingAgent(
            ScheduleAgentCallFailed("TIMEOUT", retryable = true, message = "상대가 응답하지 않음"),
        )
        val e = shouldThrow<UpstreamUnavailable> {
            service(down).propose(acc, tripId, RequestSlotCandidates(SlotKey.of(d1, target), null, null, null))
        }
        e.source shouldBe "schedule-agent"
        // 후보는 지어낼 수 없다(INV-1) — 빈 목록으로 접으면 "주변에 없음"과 구분되지 않는다.
        e.fallbackApplied shouldBe false
    }

    "AI 에 묻는 후보는 그 여행에서 고른 취향으로 고른다 — 생성과 같은 척도(BR-U1-38)" {
        val withSnapshot = object : TripFacade {
            override fun findPeriod(accountId: UUID, tripId: UUID) = TripPeriod(d1, d1)
            override fun findGenerationContext(accountId: UUID, tripId: UUID) = TripGenerationContext(
                d1, d1, emptyList(), "친구", null, emptyList(),
                preferenceSnapshot = mapOf("styles" to listOf("미식"), "activities" to emptyList<String>()),
            )
        }
        val agent = CapturingAgent()

        service(agent, tripFacade = withSnapshot).propose(acc, tripId, RequestSlotCandidates(SlotKey.of(d1, target), null, null, null))

        val sent = agent.captured!!
        sent.preferenceProfile!!.styles shouldContainExactly listOf("미식")
        sent.preferenceProfile!!.transportModes shouldContainExactly listOf("대중교통") // 여행이 안 정한 축은 계정
        sent.companionType shouldBe "친구"
    }

    "이미 일정에 있는 장소를 서버가 제외 목록으로 만든다(BR-U3-24)" {
        val agent = CapturingAgent()
        service(agent).propose(acc, tripId, RequestSlotCandidates(SlotKey.of(d1, target), null, null, null))

        // 클라이언트는 제외 목록을 보내지 않는다 — 서버가 현재 일정 전체에서 유도한다
        agent.captured!!.excludePoiIds.toSet() shouldBe setOf(neighborBefore, target, neighborAfter)
    }

    "직전·직후 슬롯을 이웃으로 넘긴다(동선 트레이드오프 입력)" {
        val agent = CapturingAgent()
        service(agent).propose(acc, tripId, RequestSlotCandidates(SlotKey.of(d1, target), null, null, null))

        agent.captured!!.neighborSlotKeys shouldContainExactly
            listOf(SlotKey.of(d1, neighborBefore), SlotKey.of(d1, neighborAfter))
    }

    // ── 탐색 중심(TRIP-1252) ────────────────────────────────────────────────────
    // POI 마다 좌표가 **달라야** 중심이 어디인지 가려진다. 공용 `surfaces` 는 전 POI 가 같은
    // 좌표라 이 축을 재지 못한다 — 그걸 쓰면 이 스펙은 늘 통과하는 공허한 단언이 된다.
    val distinctSurfaces = object : PoiSurfaceFacade {
        val coords = mapOf(
            neighborBefore to (33.10 to 126.10), // 직전 — 사용자가 방금 고른 자리
            target to (33.90 to 126.90),         // 교체 대상 — AI 원배치
            neighborAfter to (33.50 to 126.50),
        )
        override fun findSurfaces(poiIds: Collection<UUID>) = poiIds.mapNotNull { id ->
            coords[id]?.let { (lat, lng) -> id to PoiSurfaceView(id, "장소", lat, lng, "명소", "SIGHT", null, null, emptyList()) }
        }.toMap()
        override fun findFrozenSurfaces(poiSnapshotIds: Collection<UUID>) = emptyMap<UUID, FrozenPoiView>()
    }

    fun serviceWithDistinctCoords(agent: CapturingAgent) =
        SlotCandidateService(trips, Repo(itinerary), agent, distinctSurfaces, pool, FakeScoredCandidatePoolStore(), clock, accountPrefs, NoHints)

    "같이 고르기는 직전 슬롯을 탐색 중심으로 쓴다 — 방금 고른 곳에서 다음 발걸음이다(TRIP-1252)" {
        val agent = CapturingAgent()

        serviceWithDistinctCoords(agent)
            .propose(acc, tripId, RequestSlotCandidates(SlotKey.of(d1, target), null, null, null, coPick = true))

        // AI 원배치(33.90)가 아니라 직전 선택(33.10)이 중심이다. 이게 뒤집히면 칸을 고를수록
        // 동선이 도시 전체로 튄다 — 경산 6칸 재현(2026-10-05).
        agent.captured!!.centerLat shouldBe 33.10
        agent.captured!!.centerLng shouldBe 126.10
    }

    "완전 AI '다른 후보'는 교체 대상이 중심이다 — '이 자리 대체'라 그 자리가 맥락이다(BR-U3-23 유지)" {
        val agent = CapturingAgent()

        serviceWithDistinctCoords(agent)
            .propose(acc, tripId, RequestSlotCandidates(SlotKey.of(d1, target), null, null, null))

        agent.captured!!.centerLat shouldBe 33.90
        agent.captured!!.centerLng shouldBe 126.90
    }

    "같이 고르기라도 첫 칸이면 교체 대상이 중심이다 — 직전이 없으면 옮길 데가 없다" {
        val agent = CapturingAgent()

        // neighborBefore 가 그 날의 첫 슬롯이다(index 0).
        serviceWithDistinctCoords(agent)
            .propose(acc, tripId, RequestSlotCandidates(SlotKey.of(d1, neighborBefore), null, null, null, coPick = true))

        agent.captured!!.centerLat shouldBe 33.10
        agent.captured!!.centerLng shouldBe 126.10
    }

    "첫 슬롯이면 이웃이 하나뿐이다" {
        val agent = CapturingAgent()
        service(agent).propose(acc, tripId, RequestSlotCandidates(SlotKey.of(d1, neighborBefore), null, null, null))
        agent.captured!!.neighborSlotKeys shouldContainExactly listOf(SlotKey.of(d1, target))
    }

    "반경·컨셉은 그대로 전달하고, 실제 사용 반경은 응답값을 쓴다(BR-U3-25)" {
        val agent = CapturingAgent()
        val out = service(agent).propose(acc, tripId, RequestSlotCandidates(SlotKey.of(d1, target), 3_000, "감성", null))

        agent.captured!!.radiusM shouldBe 3_000
        agent.captured!!.concept shouldBe "감성"
        out.radiusMUsed shouldBe 12_000 // AI 가 넓힌 값 — 요청값이 아니라 응답값을 노출한다
    }

    "슬롯 키 형식이 틀리면 400" {
        shouldThrow<ValidationFailed> {
            service(CapturingAgent()).propose(acc, tripId, RequestSlotCandidates("이상한키", null, null, null))
        }
    }

    "타 계정·없는 일정·없는 슬롯은 404" {
        shouldThrow<ResourceNotFound> {
            service(CapturingAgent()).propose(UUID.randomUUID(), tripId, RequestSlotCandidates(SlotKey.of(d1, target), null, null, null))
        }
        shouldThrow<ResourceNotFound> {
            service(CapturingAgent(), stored = null).propose(acc, tripId, RequestSlotCandidates(SlotKey.of(d1, target), null, null, null))
        }
        shouldThrow<ResourceNotFound> {
            service(CapturingAgent()).propose(acc, tripId, RequestSlotCandidates(SlotKey.of(d1, UUID.randomUUID()), null, null, null))
        }
    }

    "반경 상한을 넘으면 400 — 상한 없이 두면 전 DB 스캔이 된다" {
        shouldThrow<ValidationFailed> {
            service(CapturingAgent()).propose(
                acc, tripId, RequestSlotCandidates(SlotKey.of(d1, target), Int.MAX_VALUE, null, null),
            )
        }
    }

    "확정된 일정에는 후보를 제안하지 않는다 — 골라도 편집이 막힌다" {
        val confirmed = itinerary.confirm(
            itinerary.days.flatMap { it.slots }.associate { it.sourcePoiId to UUID.randomUUID() }, now,
        )
        shouldThrow<ConflictDetected> {
            service(CapturingAgent(), stored = confirmed).propose(acc, tripId, RequestSlotCandidates(SlotKey.of(d1, target), null, null, null))
        }
    }

    "같은 날 같은 장소가 둘이면 어느 슬롯인지 특정할 수 없어 409" {
        val dup = Itinerary.create(
            tripId, SolveMode.FULL_AI, GenerationMode.FULLY_AI, false,
            listOf(ItineraryDay.of(d1, 0, listOf(slot(target, 0, "09:00"), slot(target, 1, "18:00")))),
            now,
        )
        shouldThrow<ConflictDetected> {
            service(CapturingAgent(), stored = dup).propose(acc, tripId, RequestSlotCandidates(SlotKey.of(d1, target), null, null, null))
        }
    }

    "생성 중이어도 이미 만들어진 일자의 후보는 준다(TRIP-1000)" {
        // day1 조기 노출(BR-U3-04·06) — 2차가 도는 10분간 이미 도착한 1일차까지 잠겼던 것이 QA #073.
        val partial = Itinerary.create(
            tripId, SolveMode.FULL_AI, GenerationMode.FULLY_AI, false,
            listOf(ItineraryDay.of(d1, 0, listOf(slot(target, 0, "11:00")))),
            now, GenerationState.PARTIAL,
        )
        val agent = CapturingAgent()
        service(agent, stored = partial).propose(acc, tripId, RequestSlotCandidates(SlotKey.of(d1, target), null, null, null))

        agent.captured shouldNotBe null // 잠기지 않고 경계까지 간다
    }

    "생성 중인 일자(아직 없음)는 409 — 404 로 '일정이 없다'고 말하지 않는다" {
        val partial = Itinerary.create(
            tripId, SolveMode.FULL_AI, GenerationMode.FULLY_AI, false,
            listOf(ItineraryDay.of(d1, 0, listOf(slot(target, 0, "11:00")))),
            now, GenerationState.PARTIAL,
        )
        shouldThrow<ConflictDetected> {
            service(CapturingAgent(), stored = partial)
                .propose(acc, tripId, RequestSlotCandidates(SlotKey.of(d1.plusDays(1), target), null, null, null))
        }
    }

    "후보는 정본에 실재하는지 다시 확인한다(INV-1 closed-set)" {
        // 스펙 스코프에서 pool 을 공유하므로 증분으로 본다.
        val before = pool.grounded
        service(CapturingAgent()).propose(acc, tripId, RequestSlotCandidates(SlotKey.of(d1, target), null, null, null))
        pool.grounded shouldBe before + 1
    }

    // ───── 즉답 — 생성 시점 점수 후보(TRIP-969) ─────────────────────────────

    val cafeSpareHigh = UUID.randomUUID()
    val cafeSpareLow = UUID.randomUUID()

    /** 교체 대상(카페) + 같은 카테고리 예비 2 + 다른 카테고리 1 + 이미 일정에 있는 카페 1. */
    fun storedPool(radiusM: Int = 12_000) = FakeScoredCandidatePoolStore().apply {
        replace(
            tripId,
            ScoredCandidatePool(
                radiusM,
                listOf(
                    ScoredCandidate(target, 0.9, "카페"),
                    ScoredCandidate(cafeSpareLow, 0.8, "카페"),
                    ScoredCandidate(cafeSpareHigh, 0.95, "카페"),
                    ScoredCandidate(UUID.randomUUID(), 0.99, "명소"), // 다른 카테고리 — 즉답 대상 아님
                    ScoredCandidate(neighborBefore, 0.97, "카페"),    // 이미 일정에 있음 — 제외(BR-U3-24)
                ),
            ),
        )
    }

    /** 반경 조회가 돌려주는 것(= 지금도 ACTIVE 인 것)과 거리를 지정한다. */
    fun resolving(vararg distances: Pair<UUID, Double>) = object : CandidatePoolPort {
        override fun resolve(area: Area, categories: Set<String>) =
            distances.map { (id, m) -> GroundedPlace(id, "장소", 33.45, 126.56, "카페", null, m) }
        override fun ground(poiIds: List<UUID>) =
            poiIds.map { GroundedPlace(it, "장소", 33.45, 126.56, "카페", null, null) }
    }

    "저장된 점수 후보가 요청을 덮으면 AI 를 부르지 않는다 — 같은 카테고리를 점수 내림차순으로 즉답" {
        val agent = CapturingAgent()
        val out = service(agent, scored = storedPool(), candidates = resolving(cafeSpareHigh to 500.0, cafeSpareLow to 300.0))
            .propose(acc, tripId, RequestSlotCandidates(SlotKey.of(d1, target), null, null, null))

        agent.captured shouldBe null // LLM 0회 — 버튼마다 25초 예산을 태우지 않는 것이 이 티켓의 요점
        out.candidates.map { it.poiId } shouldContainExactly listOf(cafeSpareHigh, cafeSpareLow)
        out.candidates[0].distanceRange shouldBe "약 0.5km" // 거리만(INV-3)
        out.radiusMUsed shouldBe 12_000 // 요청이 반경을 안 줬으면 저장 반경이 실제 사용 반경이다
    }

    "concept 이 오면 전개한다 — 저장 점수는 '이런 느낌으로'를 모른다" {
        val agent = CapturingAgent()
        service(agent, scored = storedPool(), candidates = resolving(cafeSpareHigh to 500.0))
            .propose(acc, tripId, RequestSlotCandidates(SlotKey.of(d1, target), null, "감성", null))

        agent.captured!!.concept shouldBe "감성"
    }

    "요청 반경이 저장 반경을 넘으면 전개한다 — 저장 풀이 그 반경을 안 덮는다" {
        val agent = CapturingAgent()
        service(agent, scored = storedPool(radiusM = 3_000), candidates = resolving(cafeSpareHigh to 500.0))
            .propose(acc, tripId, RequestSlotCandidates(SlotKey.of(d1, target), 10_000, null, null))

        agent.captured!!.radiusM shouldBe 10_000
    }

    "같은 카테고리 예비가 0건이면 전개한다 — 실측에서 유일하게 실제 발동하는 조건" {
        val agent = CapturingAgent()
        val scored = FakeScoredCandidatePoolStore().apply {
            replace(
                tripId,
                ScoredCandidatePool(12_000, listOf(ScoredCandidate(target, 0.9, "카페"), ScoredCandidate(UUID.randomUUID(), 0.99, "명소"))),
            )
        }
        service(agent, scored = scored, candidates = resolving())
            .propose(acc, tripId, RequestSlotCandidates(SlotKey.of(d1, target), null, null, null))

        agent.captured shouldNotBe null
    }

    "교체 대상이 풀에 없으면 전개한다 — 카테고리를 모르는 채 즉답하지 않는다" {
        val agent = CapturingAgent()
        val scored = FakeScoredCandidatePoolStore().apply {
            replace(tripId, ScoredCandidatePool(12_000, listOf(ScoredCandidate(cafeSpareHigh, 0.95, "카페"))))
        }
        service(agent, scored = scored, candidates = resolving(cafeSpareHigh to 500.0))
            .propose(acc, tripId, RequestSlotCandidates(SlotKey.of(d1, target), null, null, null))

        agent.captured shouldNotBe null
    }

    "생성 뒤 비활성된 후보는 즉답에 싣지 않는다 — 반경 조회(ACTIVE)에 없으면 빠진다" {
        val agent = CapturingAgent()
        val out = service(agent, scored = storedPool(), candidates = resolving(cafeSpareHigh to 500.0))
            .propose(acc, tripId, RequestSlotCandidates(SlotKey.of(d1, target), null, null, null))

        out.candidates.map { it.poiId } shouldContainExactly listOf(cafeSpareHigh)
    }

    "전개가 0건이면 저장분으로 구제한다 — 지금보다 나빠지는 경우 0" {
        // 요청 반경(10km) > 저장 반경(3km)이라 전개로 갔는데 결과가 비었다 — 저장 반경 안의
        // 예비는 요청 반경 안이기도 하므로 그것을 주는 쪽이 빈 손보다 낫다.
        val agent = CapturingAgent(respondEmpty = true)
        val out = service(agent, scored = storedPool(radiusM = 3_000), candidates = resolving(cafeSpareHigh to 500.0))
            .propose(acc, tripId, RequestSlotCandidates(SlotKey.of(d1, target), 10_000, null, null))

        agent.captured shouldNotBe null // 전개는 갔다 — 그 결과가 저장분보다 나빠 저장분이 나간다
        out.candidates.map { it.poiId } shouldContainExactly listOf(cafeSpareHigh)
    }

    // ─── 컨셉 필터(TRIP-1065 · QA #042 — '식사'를 골라도 기념탑·도서관이 오던 결함) ───

    fun fixedAgent(vararg cands: SlotCandidate) = object : StubScheduleAgent() {
        override fun proposeSlotCandidates(input: SlotCandidatesInput) = SlotCandidatesOutput(
            cands.toList(), radiusMUsed = 3_000,
            freshness = FreshnessMeta(now, degraded = false), emptyReason = null,
        )
    }

    // 종전 거짓 근거를 그대로 재현한 문구 — 필터가 없으면 이대로 나갔다.
    fun cand(id: UUID) = SlotCandidate(id, "약 1.0km", "식사 컨셉에 맞는 명소")

    /** ground = poiId 별 카테고리, resolve = 컨셉 채움용 풀(요청 카테고리로 거른다). */
    fun conceptPool(categoriesById: Map<UUID, String>, refill: List<GroundedPlace> = emptyList()) =
        object : CandidatePoolPort {
            override fun resolve(area: Area, categories: Set<String>) =
                refill.filter { categories.isEmpty() || it.category in categories }
            override fun ground(poiIds: List<UUID>) = poiIds.mapNotNull { id ->
                categoriesById[id]?.let { GroundedPlace(id, "장소", 33.45, 126.56, it, null, null) }
            }
        }

    fun conceptSvc(agent: StubScheduleAgent, pool: CandidatePoolPort) =
        SlotCandidateService(trips, Repo(itinerary), agent, surfaces, pool, FakeScoredCandidatePoolStore(), clock, accountPrefs, NoHints)

    fun req(concept: String?) = RequestSlotCandidates(SlotKey.of(d1, target), null, concept, null)

    "'식사' 컨셉이면 맛집만 남는다 — 경계가 명소를 섞어 줘도(모든 경로 공통 후처리)" {
        val food1 = UUID.randomUUID()
        val sight = UUID.randomUUID()
        val food2 = UUID.randomUUID()
        val out = conceptSvc(
            fixedAgent(cand(food1), cand(sight), cand(food2)),
            conceptPool(mapOf(food1 to "맛집", sight to "명소", food2 to "맛집")),
        ).propose(acc, tripId, req("식사"))

        out.candidates.map { it.poiId } shouldContainExactly listOf(food1, food2)
    }

    "경계가 컨셉 밖 후보만 주면 컨셉 카테고리 풀로 채운다 — 문구는 참, 강등 표시(INV-4)" {
        val sight = UUID.randomUUID()
        val food = UUID.randomUUID()
        val out = conceptSvc(
            fixedAgent(cand(sight)),
            conceptPool(mapOf(sight to "명소"), refill = listOf(GroundedPlace(food, "국밥집", 33.45, 126.56, "맛집", null, 500.0))),
        ).propose(acc, tripId, req("식사"))

        out.candidates.single().poiId shouldBe food
        out.candidates.single().rationale shouldBe "식사 컨셉에 맞는 맛집"
        out.freshness.degraded shouldBe true // 거리순 채움은 AI 추천이 아니다 — 화면이 사실을 알게
    }

    "컨셉 카테고리가 반경(넓힘 포함) 안에 없으면 0건 + NO_NEARBY — 명소로 채우면 위반(결정 3a)" {
        val sight = UUID.randomUUID()
        val out = conceptSvc(fixedAgent(cand(sight)), conceptPool(mapOf(sight to "명소")))
            .propose(acc, tripId, req("식사"))

        out.candidates shouldBe emptyList()
        out.emptyReason shouldBe SlotCandidatesEmptyReason.NO_NEARBY
    }

    "매핑에 없는 컨셉은 필터 없이 기존 동작 — 400 이 아니다(reason 선례)" {
        val sight = UUID.randomUUID()
        val out = conceptSvc(fixedAgent(cand(sight)), conceptPool(mapOf(sight to "명소")))
            .propose(acc, tripId, req("아무거나"))

        out.candidates.single().poiId shouldBe sight
    }

    /** 필터는 **좁히기만** 한다(INV-1) — 매핑 컨셉이면 결과 전원이 매핑 집합, 아니면 무변경. */
    "임의 풀·임의 컨셉에서 결과는 입력의 부분집합이고 매핑 규칙을 지킨다" {
        val cats = listOf("명소", "맛집", "카페", "야경", "자연", "쇼핑", "문화", "액티비티")
        val concepts = listOf("식사", "카페", "전시·문화", "야외·산책", "쇼핑", "아무거나", null)
        checkAll(Arb.list(Arb.int(0..7), 0..8), Arb.int(0..6)) { pickCats, ci ->
            val concept = concepts[ci]
            val ids = pickCats.map { UUID.randomUUID() to cats[it] }
            val out = conceptSvc(
                fixedAgent(*ids.map { cand(it.first) }.toTypedArray()),
                conceptPool(ids.toMap()),
            ).propose(acc, tripId, req(concept))

            val mapped = ConceptCategories.of(concept)
            if (mapped == null) {
                out.candidates.map { it.poiId } shouldBe ids.map { it.first } // 무변경
            } else {
                out.candidates.map { it.poiId } shouldBe ids.filter { it.second in mapped }.map { it.first }
            }
        }
    }
})
