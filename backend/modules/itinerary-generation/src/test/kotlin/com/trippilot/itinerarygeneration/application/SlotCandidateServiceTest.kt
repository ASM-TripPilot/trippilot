package com.trippilot.itinerarygeneration.application

import com.trippilot.itinerarygeneration.api.SlotCandidateFacade
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
import com.trippilot.itinerarygeneration.domain.DayAnchor
import com.trippilot.itinerarygeneration.domain.DaySchedule
import com.trippilot.itinerarygeneration.domain.RepairContext
import com.trippilot.itinerarygeneration.domain.RepairResult
import com.trippilot.itinerarygeneration.domain.ScheduleAgentOutput
import com.trippilot.itinerarygeneration.domain.Violation
import com.trippilot.itinerarygeneration.domain.VisitSlotDisplay
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
import com.trippilot.placedata.api.RegionCenter
import com.trippilot.placedata.api.RegionLookupFacade
import com.trippilot.savedaccommodation.api.BaseAnchorFacade
import com.trippilot.savedaccommodation.api.DayAnchorView
import com.trippilot.trip.api.TripDestinationRef
import com.trippilot.trip.api.TripFacade
import com.trippilot.trip.api.TripPeriod
import io.kotest.assertions.throwables.shouldThrow
import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.collections.shouldContainExactly
import io.kotest.matchers.collections.shouldNotBeEmpty
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

    /** 적합 판정의 수리 컨텍스트 원천 — 앵커는 숙소([stays])로만. 여행 정보가 없으면(공용 [trips]) 컨텍스트 없음이다. */
    val noRegions = object : RegionLookupFacade {
        override fun codesOf(regionName: String) = emptyList<String>()
        override fun isSelectableCode(regionCode: String) = false
        override fun centerOf(regionName: String): RegionCenter? = null
        override fun centerOfCode(regionCode: String): RegionCenter? = null
    }
    fun contexts(
        tripFacade: TripFacade = trips,
        stays: List<DayAnchorView> = emptyList(),
        prefs: PreferenceFacade = accountPrefs,
        regions: RegionLookupFacade = noRegions,
    ) = RepairContexts(
        tripFacade,
        object : BaseAnchorFacade {
            override fun findStayNightAnchors(tripId: UUID, startDate: LocalDate, endDate: LocalDate) = stays
        },
        regions,
        prefs,
    )

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
        // 적합 판정은 전부 통과 — fake 모드(원본 그대로)와 같다. 판정 자체는 아래 '적합 판정' 스펙이 잰다.
        override fun repair(solution: ScheduleAgentOutput, violations: List<Violation>) = RepairResult(solution, emptyList())
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
        at: Clock = clock,
    ) = SlotCandidateService(tripFacade, Repo(stored), agent, surfaces, candidates, scored, at, accountPrefs, NoHints, contexts())

    /**
     * 공개 퍼사드(U8 G-U8-2 · TRIP-1376) — 도우미가 보는 것은 이 계약뿐이다. **REST 와 같은 서비스**를 타는지가
     * 요점이다: 제외 목록·이웃·closed-set 재확인이 그대로 걸려야 화면의 "다른 후보"와 도우미의 후보가 같다.
     */
    "공개 퍼사드가 REST 와 같은 경로로 후보를 낸다 — 기본 반경·컨셉 없음, 강등 여부를 싣는다" {
        val agent = CapturingAgent()
        val facade: SlotCandidateFacade = service(agent)

        val view = facade.propose(acc, tripId, SlotKey.of(d1, target))

        val sent = agent.captured!!
        sent.slotKey shouldBe SlotKey.of(d1, target)
        sent.radiusM shouldBe null
        sent.concept shouldBe null
        sent.reason shouldBe null
        sent.excludePoiIds.isNotEmpty() shouldBe true // 서버가 유도한 제외 목록이 그대로 걸린다(BR-U3-24)
        view.candidates.single().let { (it.distanceRange to it.rationale) shouldBe ("약 1.1km" to "주변 카페") }
        view.degraded shouldBe false
        view.emptyReason shouldBe null
    }

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
        SlotCandidateService(trips, Repo(itinerary), agent, distinctSurfaces, pool, FakeScoredCandidatePoolStore(), clock, accountPrefs, NoHints, contexts())

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

    "직전 슬롯이 정본에서 사라졌으면 교체 대상으로 물러선다 — 그 요청까지 죽이지 않는다" {
        // 적대적 리뷰가 잡은 미검증 분기: 공용 fake 는 전 POI 에 좌표를 줘서 이 경로를 아무도 안 지난다.
        // 직전 장소가 하드 삭제된 것은 **이 요청의 잘못이 아니라서** 404 로 죽이지 않고 물러선다.
        val agent = CapturingAgent()
        val missingPrev = object : PoiSurfaceFacade {
            override fun findSurfaces(poiIds: Collection<UUID>) = poiIds
                .filterNot { it == neighborBefore }   // 직전 슬롯만 정본에서 사라진 상태
                .associateWith { PoiSurfaceView(it, "장소", 33.90, 126.90, "명소", "SIGHT", null, null, emptyList()) }
            override fun findFrozenSurfaces(poiSnapshotIds: Collection<UUID>) = emptyMap<UUID, FrozenPoiView>()
        }

        SlotCandidateService(trips, Repo(itinerary), agent, missingPrev, pool, FakeScoredCandidatePoolStore(), clock, accountPrefs, NoHints, contexts())
            .propose(acc, tripId, RequestSlotCandidates(SlotKey.of(d1, target), null, null, null, coPick = true))

        // 교체 대상 좌표로 물러섰다(요청은 성사된다).
        agent.captured!!.centerLat shouldBe 33.90
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

    /** 잠금 범위는 편집(EditItineraryService)과 같다 — 확정 일정은 여행 시작 전만 잠긴다(TRIP-999 결정 (a)). */
    "확정된 일정은 여행 시작 전에는 후보를 제안하지 않고, 시작한 날부터는 제안한다" {
        val confirmed = itinerary.confirm(
            itinerary.days.flatMap { it.slots }.associate { it.sourcePoiId to UUID.randomUUID() }, now,
        )
        val request = RequestSlotCandidates(SlotKey.of(d1, target), null, null, null)
        // 여행 첫날 00:00 KST 의 1초 전 — 잠금 경계는 서울 날짜로 잰다
        val eve = Clock.fixed(Instant.parse("2026-07-31T14:59:59Z"), ZoneOffset.UTC)
        val firstDay = Clock.fixed(Instant.parse("2026-07-31T15:00:00Z"), ZoneOffset.UTC)

        shouldThrow<ConflictDetected> { service(CapturingAgent(), stored = confirmed, at = eve).propose(acc, tripId, request) }
        service(CapturingAgent(), stored = confirmed, at = firstDay).propose(acc, tripId, request).candidates.shouldNotBeEmpty()
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
        override fun repair(solution: ScheduleAgentOutput, violations: List<Violation>) = RepairResult(solution, emptyList())
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
        SlotCandidateService(trips, Repo(itinerary), agent, surfaces, pool, FakeScoredCandidatePoolStore(), clock, accountPrefs, NoHints, contexts())

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

    // ─── 0건 1회 확장(TRIP-1311 · BR-U3-25) — 컨셉 없는 요청도 넓혀 본다 ───

    fun emptyAgent(reason: SlotCandidatesEmptyReason) = object : StubScheduleAgent() {
        override fun proposeSlotCandidates(input: SlotCandidatesInput) = SlotCandidatesOutput(
            emptyList(), radiusMUsed = 3_000,
            freshness = FreshnessMeta(now, degraded = true), emptyReason = reason,
        )
        override fun repair(solution: ScheduleAgentOutput, violations: List<Violation>) = RepairResult(solution, emptyList())
    }

    /** 반경별 풀 — 요청 반경 이내만 돌려주고, 몇 번·어느 반경으로 물었는지 남긴다. */
    class RadiusPool(private val places: List<GroundedPlace>) : CandidatePoolPort {
        val radii = mutableListOf<Double>()
        override fun resolve(area: Area, categories: Set<String>): List<GroundedPlace> {
            val r = (area as Area.Radius).radiusM
            radii += r
            return places.filter { (it.distanceM ?: 0.0) <= r }
        }
        override fun ground(poiIds: List<UUID>) = poiIds.map { GroundedPlace(it, "장소", 33.45, 126.56, "명소", null, null) }
    }

    "NO_NEARBY 0건이면 반경을 한 단계 넓혀 1회 다시 본다 — 실제 쓴 반경을 알린다" {
        val far = UUID.randomUUID()
        val pool = RadiusPool(listOf(GroundedPlace(far, "먼 국밥집", 33.45, 126.56, "맛집", null, 11_300.0)))
        val out = conceptSvc(emptyAgent(SlotCandidatesEmptyReason.NO_NEARBY), pool).propose(acc, tripId, req(null))

        out.candidates.map { it.poiId } shouldContainExactly listOf(far) // closed-set 풀에서만(INV-1)
        out.candidates.single().distanceRange shouldBe "약 11.3km"
        out.candidates.single().rationale shouldBe "주변 맛집"
        out.radiusMUsed shouldBe 12_000
        out.emptyReason shouldBe null
        out.freshness.degraded shouldBe true // 거리순 채움은 AI 추천이 아니다(INV-4)
    }

    "ALL_IN_ITINERARY 0건이면 넓히지 않는다 — 넓혀도 같은 결과다" {
        val pool = RadiusPool(listOf(GroundedPlace(UUID.randomUUID(), "먼 국밥집", 33.45, 126.56, "맛집", null, 11_300.0)))
        val out = conceptSvc(emptyAgent(SlotCandidatesEmptyReason.ALL_IN_ITINERARY), pool).propose(acc, tripId, req(null))

        out.candidates shouldBe emptyList()
        out.emptyReason shouldBe SlotCandidatesEmptyReason.ALL_IN_ITINERARY
        pool.radii shouldBe emptyList()
    }

    "넓혀도 0건이면 한 번으로 끝난다 — NO_NEARBY 그대로, 무한 확장 없음" {
        val pool = RadiusPool(listOf(GroundedPlace(UUID.randomUUID(), "아주 먼 곳", 33.45, 126.56, "명소", null, 30_000.0)))
        val out = conceptSvc(emptyAgent(SlotCandidatesEmptyReason.NO_NEARBY), pool).propose(acc, tripId, req(null))

        out.candidates shouldBe emptyList()
        out.emptyReason shouldBe SlotCandidatesEmptyReason.NO_NEARBY
        out.radiusMUsed shouldBe 12_000
        pool.radii shouldBe listOf(3_000.0, 12_000.0)
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

    "공개 퍼사드가 0건의 이유와 강등을 이름 그대로 옮긴다 — 안내가 정반대라 뭉개지 않는다" {
        val facade: SlotCandidateFacade = conceptSvc(emptyAgent(SlotCandidatesEmptyReason.ALL_IN_ITINERARY), RadiusPool(emptyList()))

        val view = facade.propose(acc, tripId, SlotKey.of(d1, target))

        view.candidates shouldBe emptyList()
        view.degraded shouldBe true
        view.emptyReason shouldBe "ALL_IN_ITINERARY"
    }

    // ─── 적합 판정 — 그 슬롯 시각에 실제로 들어가는 후보만(로컬 재현 28회 교체 중 3건이 HC1 위반으로 저장) ───

    /**
     * 판정 대역 — 일정에 [misfit] 장소가 들어 있으면 수리 불가, [moved] 장소면 시각을 밀어 수리, [broken] 장소면 그 예외.
     * 후보 판정은 **대상 칸만** 바꾸므로 "그 장소가 일정에 있는가"가 곧 "대상 칸에 그 장소를 넣었는가"다.
     */
    class FitAgent(
        private val proposed: List<UUID> = emptyList(),
        private val misfit: Set<UUID> = emptySet(),
        private val moved: Set<UUID> = emptySet(),
        private val broken: Map<UUID, RuntimeException> = emptyMap(),
        /** 0건 응답의 사유 — NO_NEARBY 면 풀 직접 채움 갈래(0건 확장)를 탄다. */
        private val emptyReason: SlotCandidatesEmptyReason? = null,
    ) : StubScheduleAgent() {
        val repaired = mutableListOf<Pair<ScheduleAgentOutput, List<Violation>>>()
        val contexts = mutableListOf<RepairContext>()
        var proposeCalls = 0
        override fun proposeSlotCandidates(input: SlotCandidatesInput): SlotCandidatesOutput {
            proposeCalls++
            return SlotCandidatesOutput(
                proposed.map { SlotCandidate(it, "약 1.0km", "주변 명소") }, radiusMUsed = 3_000,
                freshness = FreshnessMeta(Instant.parse("2026-08-06T00:00:00Z"), degraded = false), emptyReason = emptyReason,
            )
        }
        override fun repair(solution: ScheduleAgentOutput, violations: List<Violation>, context: RepairContext): RepairResult {
            contexts += context
            return repair(solution, violations)
        }
        override fun repair(solution: ScheduleAgentOutput, violations: List<Violation>): RepairResult {
            repaired += solution to violations
            val placed = solution.days.flatMap { d -> d.slots.map { it.poiId } }.toSet()
            broken.entries.firstOrNull { it.key in placed }?.let { throw it.value }
            if (placed.any { it in moved }) { // 실측 28건 중 7건 — repair 가 시각을 밀어 해결(moved=True)
                val shifted = solution.days.map { d -> d.copy(slots = d.slots.map { it.copy(startAt = it.startAt.plusMinutes(30), endAt = it.endAt.plusMinutes(30)) }) }
                return RepairResult(solution.copy(days = shifted), listOf("시작 시각 30분 뒤로"))
            }
            return RepairResult(solution, emptyList(), unrepairable = placed.any { it in misfit })
        }
    }

    fun fitSvc(
        agent: FitAgent,
        stored: Itinerary = itinerary,
        scored: ScoredCandidatePoolStore = FakeScoredCandidatePoolStore(),
        candidates: CandidatePoolPort = pool,
        tripFacade: TripFacade = trips,
        repairContexts: RepairContexts = contexts(),
    ) = SlotCandidateService(tripFacade, Repo(stored), agent, surfaces, candidates, scored, clock, accountPrefs, NoHints, repairContexts)

    // 순서 단언용 고정 ID — 기대 순서와 자연 정렬이 반대라, 정렬로 순서를 바꾸는 구현이 우연히 통과하지 않는다.
    fun ids(n: Int) = List(n) { UUID(0, (n - it).toLong()) }

    "AI 후보 중 그 슬롯 시각에 못 들어가는 곳은 빠진다 — 시각만 밀면 들어가는 곳은 남고, 순서는 원래 그대로" {
        val (a, b, c, d, e) = ids(5)
        val agent = FitAgent(proposed = listOf(a, b, c, d, e), misfit = setOf(b, d), moved = setOf(c))

        val out = fitSvc(agent).propose(acc, tripId, RequestSlotCandidates(SlotKey.of(d1, target), null, null, null))

        agent.proposeCalls shouldBe 1 // AI 갈래를 탔다
        out.candidates.map { it.poiId } shouldContainExactly listOf(a, c, e) // c: 저장하면 수리값으로 들어간다 — fit
        out.radiusMUsed shouldBe 3_000 // 다른 필드는 건드리지 않는다
        out.emptyReason shouldBe null
    }

    "즉답(저장 풀)도 같은 판정을 거친다 — 생성 때 점수는 이 슬롯의 시각을 모른다" {
        val agent = FitAgent(misfit = setOf(cafeSpareHigh))

        val out = fitSvc(agent, scored = storedPool(), candidates = resolving(cafeSpareHigh to 500.0, cafeSpareLow to 300.0))
            .propose(acc, tripId, RequestSlotCandidates(SlotKey.of(d1, target), null, null, null))

        agent.proposeCalls shouldBe 0 // 즉답 갈래를 탔다
        out.candidates.map { it.poiId } shouldContainExactly listOf(cafeSpareLow)
    }

    "풀 직접 채움(0건 확장·컨셉 채움)도 같은 판정을 거친다 — 판정은 closed-set·컨셉 필터·채움 **뒤**다" {
        val (near, far) = ids(2)
        val widened = fitSvc(
            FitAgent(misfit = setOf(near), emptyReason = SlotCandidatesEmptyReason.NO_NEARBY),
            candidates = RadiusPool(
                listOf(GroundedPlace(near, "가까운 곳", 33.45, 126.56, "명소", null, 500.0), GroundedPlace(far, "먼 곳", 33.45, 126.56, "명소", null, 900.0)),
            ),
        ).propose(acc, tripId, req(null))
        widened.candidates.map { it.poiId } shouldContainExactly listOf(far)
        widened.freshness.degraded shouldBe true // 채움 갈래였다

        val (sight, food1, food2) = ids(3)
        val refilled = fitSvc(
            FitAgent(proposed = listOf(sight), misfit = setOf(food1)),
            candidates = conceptPool(
                mapOf(sight to "명소"),
                refill = listOf(GroundedPlace(food1, "국밥집", 33.45, 126.56, "맛집", null, 300.0), GroundedPlace(food2, "냉면집", 33.45, 126.56, "맛집", null, 600.0)),
            ),
        ).propose(acc, tripId, req("식사"))
        refilled.candidates.map { it.poiId } shouldContainExactly listOf(food2)
    }

    "전부 못 들어가면 원래 목록을 그대로 준다 — 0건으로 접으면 '주변에 없음'이라는 거짓이 된다" {
        val (a, b) = ids(2)
        val agent = FitAgent(proposed = listOf(a, b), misfit = setOf(a, b))

        val out = fitSvc(agent).propose(acc, tripId, RequestSlotCandidates(SlotKey.of(d1, target), null, null, null))

        agent.repaired.size shouldBe 2 // 판정은 했다
        out.candidates.map { it.poiId } shouldContainExactly listOf(a, b)
        out.emptyReason shouldBe null
    }

    "판정이 예외면 그 후보부터 끝까지 판정 없이 남긴다 — 판정 못 함은 부적합이 아니고, 불통에 후보 수만큼 기다리지 않는다" {
        val (m, x, c) = ids(3)
        val timeout = FitAgent(
            proposed = listOf(m, x, c),
            misfit = setOf(m, c),
            broken = mapOf(x to ScheduleAgentCallFailed("TIMEOUT", retryable = true, message = "상대가 응답하지 않음")),
        )
        fitSvc(timeout).propose(acc, tripId, RequestSlotCandidates(SlotKey.of(d1, target), null, null, null))
            .candidates.map { it.poiId } shouldContainExactly listOf(x, c) // m 은 판정됐고 빠진다, c 는 판정 전이라 남는다
        timeout.repaired.size shouldBe 2

        // 경계 실패 타입이 아니어도 같다(스키마 불일치 등)
        val (y, z) = ids(2)
        val odd = FitAgent(proposed = listOf(y, z), misfit = setOf(z), broken = mapOf(y to IllegalStateException("스키마 불일치")))
        fitSvc(odd).propose(acc, tripId, RequestSlotCandidates(SlotKey.of(d1, target), null, null, null))
            .candidates.map { it.poiId } shouldContainExactly listOf(y, z)
        odd.repaired.size shouldBe 1
    }

    "판정은 저장 경로와 같은 수단·앵커로 묻는다 — 첫 칸 교체면 그날 숙소 앵커, 아니면 앵커 없이" {
        // 저장(attemptRepair)은 여행 수단과 '첫 구간이 바뀐 날'의 앵커를 싣는다. 빼면 상대가 대중교통·앵커 없음으로 재서
        // 렌터카 여행이나 첫 칸 교체에서 저장과 다른 판정이 나온다.
        val rentalTrip = object : TripFacade {
            override fun findPeriod(accountId: UUID, tripId: UUID) = TripPeriod(d1, d1)
            override fun findGenerationContext(accountId: UUID, tripId: UUID) = TripGenerationContext(d1, d1, emptyList(), "혼자", null, emptyList())
        }
        val rental = object : PreferenceFacade {
            override fun findPreferences(accountId: UUID) =
                PreferenceSnapshot(emptyList(), emptyList(), emptyList(), listOf("렌터카"), null, emptyList(), false, null)
        }
        val withContext = contexts(rentalTrip, stays = listOf(DayAnchorView(d1, 35.15, 129.05)), prefs = rental)
        val (a, b) = ids(2)

        val first = FitAgent(proposed = listOf(a, b))
        fitSvc(first, tripFacade = rentalTrip, repairContexts = withContext)
            .propose(acc, tripId, RequestSlotCandidates(SlotKey.of(d1, neighborBefore), null, null, null)) // index 0
        first.contexts shouldContainExactly List(2) { RepairContext(listOf(DayAnchor(d1, 35.15, 129.05)), listOf("렌터카")) }

        val middle = FitAgent(proposed = listOf(a, b))
        fitSvc(middle, tripFacade = rentalTrip, repairContexts = withContext)
            .propose(acc, tripId, RequestSlotCandidates(SlotKey.of(d1, target), null, null, null)) // index 1
        middle.contexts shouldContainExactly List(2) { RepairContext(emptyList(), listOf("렌터카")) }
    }

    "컨텍스트 조회가 깨지면 컨텍스트 없이 판정한다 — 저장 경로와 같은 물러섬" {
        val broken = contexts(
            object : TripFacade {
                override fun findPeriod(accountId: UUID, tripId: UUID): TripPeriod? = null
                override fun findGenerationContext(accountId: UUID, tripId: UUID): TripGenerationContext? = throw IllegalStateException("db down")
            },
        )
        val (a, b) = ids(2)
        val agent = FitAgent(proposed = listOf(a, b), misfit = setOf(a))

        val out = fitSvc(agent, repairContexts = broken).propose(acc, tripId, RequestSlotCandidates(SlotKey.of(d1, target), null, null, null))

        agent.contexts shouldContainExactly listOf(RepairContext.NONE, RepairContext.NONE)
        out.candidates.map { it.poiId } shouldContainExactly listOf(b) // 판정은 그대로 했다
    }

    "판정에 넘기는 일정은 대상 날 하나, 대상 칸의 장소만 후보로 바꾼 것이다 — 시각·고정·자정 넘김·출처는 그대로" {
        // 대상은 **둘째 날** index 1 이고 첫째 날에도 index 1 이 있다 — 날짜를 안 보거나 첫째 날을 고르는 구현은 첫째 날을 바꾼다.
        // 다른 날은 보내지 않는다 — 상대 repair 는 일정 전체가 수리되는지를 답해, 다른 날의 무관한 칸이 모든 후보를 떨어뜨린다.
        // 대상 칸 자체가 자정 넘김·고정이라, 바꾼 칸을 새로 만들며 그 값을 잃는 구현도 걸린다.
        val d2 = d1.plusDays(1)
        val other = UUID.randomUUID()
        val twoDays = Itinerary.create(
            tripId, SolveMode.DETERMINISTIC, GenerationMode.FULLY_AI, true,
            listOf(
                ItineraryDay.of(
                    d1, 0,
                    listOf(
                        VisitSlot.of(neighborBefore, null, 0, LocalTime.parse("09:00"), LocalTime.parse("10:00"), isFixed = true),
                        VisitSlot.of(neighborAfter, null, 1, LocalTime.parse("18:30"), LocalTime.parse("20:00")),
                    ),
                ),
                ItineraryDay.of(
                    d2, 1,
                    listOf(
                        VisitSlot.of(other, null, 0, LocalTime.parse("10:00"), LocalTime.parse("11:30")),
                        VisitSlot.of(target, null, 1, LocalTime.parse("22:00"), LocalTime.parse("01:00"), isFixed = true, endsNextDay = true),
                    ),
                ),
            ),
            now,
        )
        val (a, b) = ids(2)
        val agent = FitAgent(proposed = listOf(a, b))

        fitSvc(agent, stored = twoDays).propose(acc, tripId, RequestSlotCandidates(SlotKey.of(d2, target), null, null, null))

        fun expected(placed: UUID) = listOf(
            DaySchedule(
                d2,
                listOf(
                    VisitSlotDisplay(other, LocalTime.parse("10:00"), LocalTime.parse("11:30"), false, null, isFixed = false),
                    VisitSlotDisplay(placed, LocalTime.parse("22:00"), LocalTime.parse("01:00"), true, null, isFixed = true),
                ),
            ),
        )
        agent.repaired.map { it.first.days } shouldContainExactly listOf(expected(a), expected(b))
        agent.repaired.forEach { (sent, violations) ->
            violations shouldBe emptyList() // 저장 경로(편집 repair)와 같은 질문 — 위반 목록 없이 맞춰 보라
            sent.solveMode shouldBe SolveMode.DETERMINISTIC // 저장 경로처럼 일정의 출처를 그대로 싣는다
            sent.isFallback shouldBe true
        }
    }

    "후보가 0건이면 판정하지 않는다 — 컨텍스트 조회(DB)도 하지 않는다" {
        var lookups = 0
        val counting = contexts(
            object : TripFacade {
                override fun findPeriod(accountId: UUID, tripId: UUID): TripPeriod? = null
                override fun findGenerationContext(accountId: UUID, tripId: UUID): TripGenerationContext? = null.also { lookups++ }
            },
        )
        val agent = FitAgent(proposed = emptyList())

        fitSvc(agent, repairContexts = counting).propose(acc, tripId, RequestSlotCandidates(SlotKey.of(d1, target), null, null, null))

        agent.repaired shouldBe emptyList()
        lookups shouldBe 0
    }

    // ─── 찾는 중심 · 구 안 우선(2026-10-23 — 서초를 고른 같이 짜기에서 저녁이 혜화로 튀던 결함) ───

    val seochoTrip = object : TripFacade {
        override fun findPeriod(accountId: UUID, tripId: UUID) = TripPeriod(d1, d1)
        override fun findGenerationContext(accountId: UUID, tripId: UUID) =
            TripGenerationContext(d1, d1, listOf(TripDestinationRef("서초구", "11650", 1)), "혼자", null, emptyList())
    }
    val seocho = object : RegionLookupFacade by noRegions {
        override fun districtCodesOf(regionCode: String) = if (regionCode == "11650") setOf("11650") else emptySet()
        override fun centerOfCode(regionCode: String) = if (regionCode == "11650") RegionCenter(37.48, 127.03) else null
    }

    /** ground = 후보·교체 대상의 구 코드(카테고리는 전부 맛집), resolve = 반경 채움 풀(카테고리로 거른다, 부른 범위는 기록). */
    class DistrictPool(
        private val codeById: Map<UUID, String?>,
        private val refill: List<GroundedPlace> = emptyList(),
        /** 비활성(폐업) — ground 에 안 나온다. */
        private val inactive: Set<UUID> = emptySet(),
    ) : CandidatePoolPort {
        val areas = mutableListOf<Area>()
        override fun resolve(area: Area, categories: Set<String>) =
            refill.filter { categories.isEmpty() || it.category in categories }.also { areas += area }
        override fun ground(poiIds: List<UUID>) =
            poiIds.filterNot { it in inactive }.map { GroundedPlace(it, "장소", 37.5, 127.0, "맛집", null, null, codeById[it]) }
    }
    fun place(id: UUID, category: String, distanceM: Double, code: String?) = GroundedPlace(id, "장소", 37.5, 127.0, category, null, distanceM, code)

    fun spaceSvc(
        agent: StubScheduleAgent,
        candidates: CandidatePoolPort = pool,
        stays: List<DayAnchorView> = emptyList(),
        regions: RegionLookupFacade = seocho,
    ) = SlotCandidateService(
        seochoTrip, Repo(itinerary), agent, distinctSurfaces, candidates, FakeScoredCandidatePoolStore(), clock,
        accountPrefs, NoHints, contexts(seochoTrip, stays, regions = regions),
    )
    fun centered(center: CandidateCenter?) = RequestSlotCandidates(SlotKey.of(d1, target), null, null, null, coPick = true, center = center)

    "구를 고른 여행이면 구 안 후보가 앞이고, 구 밖 자리는 같은 반경의 구 안 장소(거리순)로 바꾼다 — 모자라면 구 밖이 뒤에 남는다" {
        val (outA, inB, outC) = List(3) { UUID.randomUUID() }
        val (inNear, inFar, outNearest, inSight) = List(4) { UUID.randomUUID() }
        val districtPool = DistrictPool(
            mapOf(outA to "11680", inB to "11650", outC to "30110", target to "11650"),
            refill = listOf(
                place(inFar, "맛집", 800.0, "11650"),
                place(outNearest, "맛집", 100.0, "11680"), // 가장 가깝지만 구 밖
                place(inSight, "명소", 50.0, "11650"),     // 구 안이지만 점심 자리에 명소 — 교체 대상 카테고리가 아니다
                place(inB, "맛집", 10.0, "11650"),         // 이미 후보
                place(inNear, "맛집", 300.0, "11650"),
            ),
        )

        val out = spaceSvc(fixedAgent(cand(outA), cand(inB), cand(outC)), districtPool)
            .propose(acc, tripId, RequestSlotCandidates(SlotKey.of(d1, target), null, null, null))

        out.candidates.map { it.poiId } shouldContainExactly listOf(inB, inNear, inFar)
        out.freshness.degraded shouldBe true // 바꿔 넣은 것은 AI 순위가 아니라 거리순이다
        // 같은 반경(경계가 쓴 3km), 같은 중심(교체 대상)에서 찾는다 — 반경을 몰래 넓히지 않는다.
        districtPool.areas shouldContainExactly listOf(Area.Radius(33.90, 126.90, 3_000.0))

        val short = DistrictPool(mapOf(outA to "11680", inB to "11650", outC to "30110", target to "11650"), listOf(place(inNear, "맛집", 300.0, "11650")))
        spaceSvc(fixedAgent(cand(outA), cand(inB), cand(outC)), short)
            .propose(acc, tripId, RequestSlotCandidates(SlotKey.of(d1, target), null, null, null))
            .candidates.map { it.poiId } shouldContainExactly listOf(inB, inNear, outA)
    }

    "구 코드가 없는 여행(시도·옛 클라)이나 숙소·찍은 점 중심이면 순서를 건드리지 않는다" {
        val (outA, inB) = List(2) { UUID.randomUUID() }
        fun districtPool() = DistrictPool(mapOf(outA to "11680", inB to "11650"), listOf(place(UUID.randomUUID(), "맛집", 300.0, "11650")))
        val expected = listOf(outA, inB)

        spaceSvc(fixedAgent(cand(outA), cand(inB)), districtPool(), regions = noRegions)
            .propose(acc, tripId, RequestSlotCandidates(SlotKey.of(d1, target), null, null, null))
            .candidates.map { it.poiId } shouldContainExactly expected
        spaceSvc(fixedAgent(cand(outA), cand(inB)), districtPool(), stays = listOf(DayAnchorView(d1, 37.50, 127.02)))
            .propose(acc, tripId, centered(CandidateCenter(CenterMode.STAY)))
            .candidates.map { it.poiId } shouldContainExactly expected
        spaceSvc(fixedAgent(cand(outA), cand(inB)), districtPool())
            .propose(acc, tripId, centered(CandidateCenter(CenterMode.POINT, 37.57, 126.98)))
            .candidates.map { it.poiId } shouldContainExactly expected
    }

    "사용자가 고른 중심으로 찾는다 — 방금 고른 곳·구 중심·숙소·찍은 점" {
        fun centerOf(center: CandidateCenter?, coPick: Boolean = true, stays: List<DayAnchorView> = emptyList()): Pair<Double, Double> {
            val agent = CapturingAgent()
            spaceSvc(agent, stays = stays)
                .propose(acc, tripId, RequestSlotCandidates(SlotKey.of(d1, target), null, null, null, coPick = coPick, center = center))
            return agent.captured!!.centerLat to agent.captured!!.centerLng
        }

        centerOf(null) shouldBe (33.10 to 126.10)                                         // 종전 규칙(같이 고르기 = 직전)
        centerOf(CandidateCenter(CenterMode.PREVIOUS), coPick = false) shouldBe (33.10 to 126.10)
        centerOf(CandidateCenter(CenterMode.REGION)) shouldBe (37.48 to 127.03)
        centerOf(CandidateCenter(CenterMode.STAY), stays = listOf(DayAnchorView(d1, 37.50, 127.02))) shouldBe (37.50 to 127.02)
        centerOf(CandidateCenter(CenterMode.POINT, 37.57, 126.98)) shouldBe (37.57 to 126.98)
    }

    "고른 중심의 재료가 없으면 다른 중심으로 바꾸지 않는다 — 숙소 없는 날 STAY·구 중심 모름은 409, 좌표 없는 POINT 는 400" {
        shouldThrow<ConflictDetected> { spaceSvc(CapturingAgent()).propose(acc, tripId, centered(CandidateCenter(CenterMode.STAY))) }
        shouldThrow<ConflictDetected> {
            spaceSvc(CapturingAgent(), regions = noRegions).propose(acc, tripId, centered(CandidateCenter(CenterMode.REGION)))
        }
        shouldThrow<ValidationFailed> { spaceSvc(CapturingAgent()).propose(acc, tripId, centered(CandidateCenter(CenterMode.POINT, lat = 37.5))) }
        shouldThrow<ValidationFailed> { spaceSvc(CapturingAgent()).propose(acc, tripId, centered(CandidateCenter(CenterMode.POINT, 91.0, 127.0))) }
    }

    // ─── 리뷰(2026-10-23)가 재현한 구 안 우선의 모서리 ───

    "바꿔 넣은 구 안 장소가 그 시각에 안 맞으면 시각에 맞던 구 밖 후보가 남는다 — 판정 전에 자르지 않는다" {
        val (outA, outB, inX, inY) = List(4) { UUID.randomUUID() }
        val districtPool = DistrictPool(
            mapOf(outA to "11680", outB to "11680", target to "11650"),
            listOf(place(inX, "맛집", 300.0, "11650"), place(inY, "맛집", 500.0, "11650")),
        )
        val agent = FitAgent(proposed = listOf(outA, outB), misfit = setOf(inX))

        val out = spaceSvc(agent, districtPool).propose(acc, tripId, RequestSlotCandidates(SlotKey.of(d1, target), null, null, null))

        out.candidates.map { it.poiId } shouldContainExactly listOf(inY, outA) // 개수는 원래(2)대로
        agent.repaired.size shouldBe 3 // 2건이 맞으면 나머지(outB)는 판정하지 않는다
    }

    "교체 대상이 비활성(폐업)이면 카테고리를 몰라 채우지 않고 순서만 바꾼다 — 전 카테고리로 채우면 점심 자리에 술집이 온다" {
        val (outA, inB) = List(2) { UUID.randomUUID() }
        val districtPool = DistrictPool(
            mapOf(outA to "11680", inB to "11650"),
            listOf(place(UUID.randomUUID(), "술집", 100.0, "11650")),
            inactive = setOf(target),
        )

        val out = spaceSvc(fixedAgent(cand(outA), cand(inB)), districtPool)
            .propose(acc, tripId, RequestSlotCandidates(SlotKey.of(d1, target), null, null, null))

        out.candidates.map { it.poiId } shouldContainExactly listOf(inB, outA)
        districtPool.areas shouldBe emptyList()
    }

    "매핑에 없는 컨셉이면 채운 후보 문구에 그 컨셉을 싣지 않는다 — 그 컨셉으로 고른 게 아니다(BR-U2-09)" {
        val (outA, inB) = List(2) { UUID.randomUUID() }
        val districtPool = DistrictPool(mapOf(outA to "11680", target to "11650"), listOf(place(inB, "맛집", 300.0, "11650")))

        val out = spaceSvc(fixedAgent(cand(outA)), districtPool).propose(acc, tripId, req("야경"))

        out.candidates.single().let { (it.poiId to it.rationale) shouldBe (inB to "주변 맛집") }
    }

    "공간 재료 조회가 깨지면 REGION·STAY 는 '재료 없음' 409 로 말하지 않는다 — 기본 중심은 구 안 우선 없이 답한다" {
        val broken = contexts(
            object : TripFacade {
                override fun findPeriod(accountId: UUID, tripId: UUID): TripPeriod? = null
                override fun findGenerationContext(accountId: UUID, tripId: UUID): TripGenerationContext? = throw IllegalStateException("db down")
            },
        )
        fun svc(agent: StubScheduleAgent, candidates: CandidatePoolPort = pool) = SlotCandidateService(
            seochoTrip, Repo(itinerary), agent, distinctSurfaces, candidates, FakeScoredCandidatePoolStore(), clock, accountPrefs, NoHints, broken,
        )

        shouldThrow<IllegalStateException> { svc(CapturingAgent()).propose(acc, tripId, centered(CandidateCenter(CenterMode.STAY))) }
        shouldThrow<IllegalStateException> { svc(CapturingAgent()).propose(acc, tripId, centered(CandidateCenter(CenterMode.REGION))) }

        val (outA, inB) = List(2) { UUID.randomUUID() }
        svc(fixedAgent(cand(outA), cand(inB)), DistrictPool(mapOf(outA to "11680", inB to "11650")))
            .propose(acc, tripId, RequestSlotCandidates(SlotKey.of(d1, target), null, null, null))
            .candidates.map { it.poiId } shouldContainExactly listOf(outA, inB)
    }
})
