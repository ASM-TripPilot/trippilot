package com.trippilot.itinerarygeneration.application

import com.trippilot.itinerarygeneration.domain.DaySchedule
import com.trippilot.itinerarygeneration.domain.FreshnessMeta
import com.trippilot.itinerarygeneration.domain.GenerationState
import com.trippilot.itinerarygeneration.domain.GenerationMode
import com.trippilot.itinerarygeneration.domain.GenerationStatus
import com.trippilot.itinerarygeneration.domain.Itinerary
import com.trippilot.itinerarygeneration.domain.NewRevision
import com.trippilot.itinerarygeneration.domain.ItineraryRevisionRepository
import com.trippilot.itinerarygeneration.domain.ItineraryRevision
import com.trippilot.itinerarygeneration.domain.ItineraryRevisionSummary
import com.trippilot.itinerarygeneration.domain.ItineraryRepository
import com.trippilot.itinerarygeneration.domain.RepairResult
import com.trippilot.itinerarygeneration.domain.ScheduleAgentCallFailed
import com.trippilot.itinerarygeneration.domain.UnplacedMustVisit
import com.trippilot.itinerarygeneration.domain.UnplacedReason
import com.trippilot.itinerarygeneration.domain.ScheduleAgentInput
import com.trippilot.itinerarygeneration.domain.ScheduleAgentOutput
import com.trippilot.itinerarygeneration.domain.ScheduleAgentPort
import com.trippilot.itinerarygeneration.domain.SolveMode
import com.trippilot.itinerarygeneration.domain.ItineraryDay
import com.trippilot.itinerarygeneration.domain.PreferenceProfile
import com.trippilot.itinerarygeneration.domain.RequestMeta
import com.trippilot.itinerarygeneration.domain.TimeWindow
import com.trippilot.itinerarygeneration.domain.TripContext
import com.trippilot.itinerarygeneration.domain.Violation
import com.trippilot.itinerarygeneration.domain.VisitSlotDisplay
import com.trippilot.core.event.DomainEvent
import com.trippilot.core.event.DomainEventPublisher
import com.trippilot.itinerarygeneration.api.event.ItineraryGenerated
import com.trippilot.profile.api.PreferenceFacade
import com.trippilot.profile.api.PreferenceSnapshot
import com.trippilot.savedaccommodation.api.BaseAnchorFacade
import com.trippilot.savedaccommodation.api.DayAnchorView
import com.trippilot.trip.api.FixedVisit
import com.trippilot.trip.api.TripFacade
import com.trippilot.trip.api.TripGenerationContext
import com.trippilot.trip.api.TripPeriod
import io.kotest.assertions.throwables.shouldThrow
import io.kotest.core.spec.style.StringSpec
import io.kotest.property.Arb
import io.kotest.property.arbitrary.int
import io.kotest.property.checkAll
import com.trippilot.core.error.ConflictDetected
import io.kotest.matchers.collections.shouldContainExactly
import io.kotest.matchers.string.shouldContain
import io.kotest.matchers.shouldBe
import org.springframework.transaction.PlatformTransactionManager
import org.springframework.transaction.TransactionDefinition
import org.springframework.transaction.TransactionStatus
import org.springframework.transaction.support.SimpleTransactionStatus
import java.time.Clock
import java.time.Instant
import java.time.LocalDate
import java.time.LocalTime
import java.time.ZoneOffset
import java.util.UUID

/** 호출마다 입력을 기록 — day1 2단계라 1차/2차 두 번 불린다([captures] 순서 = 호출 순서). */
/**
 * 실 AI 의 거부를 흉내낸다 — 미물질화(날짜·시각 없는) 고정 블록이 **하나라도** 있으면 요청 전체를 거부한다
 * (그쪽 `api/wiring.py::_fixed_block` 이 변환 중 ValueError 를 던져 422 가 된다). 그 외 요청은 정상 응답.
 */
private class RejectAnytimeAgent(private val now: Instant, private val emitPoi: UUID) : StubScheduleAgent() {
    override fun generate(input: ScheduleAgentInput): ScheduleAgentOutput {
        if (input.fixedBlocks.any { it.date == null || it.start == null }) {
            throw ScheduleAgentCallFailed("DOMAIN_INVARIANT", retryable = false, message = "ANYTIME 고정 블록 미지원")
        }
        return ScheduleAgentOutput(
            days = input.timeWindows.map {
                DaySchedule(it.date, listOf(VisitSlotDisplay(emitPoi, LocalTime.parse("10:00"), LocalTime.parse("11:00"), false, null, isFixed = false)))
            },
            day1ReadyAt = null, explanations = emptyMap(),
            solveMode = SolveMode.DETERMINISTIC, isFallback = false,
            freshness = FreshnessMeta(now, degraded = false),
        )
    }
    override fun validate(solution: ScheduleAgentOutput): List<Violation> = emptyList()
    override fun repair(solution: ScheduleAgentOutput, violations: List<Violation>) = RepairResult(solution, emptyList())
    override fun explanations(tripId: UUID, solution: ScheduleAgentOutput): Map<String, String> = emptyMap()
}

/** 미배치 보고를 돌려주는 대역. */
private class ReportingAgent(private val now: Instant, private val unplaced: List<UnplacedMustVisit>) : StubScheduleAgent() {
    override fun generate(input: ScheduleAgentInput) = ScheduleAgentOutput(
        days = input.timeWindows.map { DaySchedule(it.date, emptyList()) },
        day1ReadyAt = null, explanations = emptyMap(),
        solveMode = SolveMode.DETERMINISTIC, isFallback = false,
        freshness = FreshnessMeta(now, degraded = false),
        unplacedMustVisits = unplaced,
    )
    override fun validate(solution: ScheduleAgentOutput): List<Violation> = emptyList()
    override fun repair(solution: ScheduleAgentOutput, violations: List<Violation>) = RepairResult(solution, emptyList())
    override fun explanations(tripId: UUID, solution: ScheduleAgentOutput): Map<String, String> = emptyMap()
}

/** 1차·2차가 서로 다른 보고를 돌려주는 대역 — 어느 쪽이 최종으로 남는지 본다. */
private class TwoPhaseReportingAgent(
    private val now: Instant,
    private val first: List<UnplacedMustVisit>,
    private val second: List<UnplacedMustVisit>,
) : StubScheduleAgent() {
    private var calls = 0
    override fun generate(input: ScheduleAgentInput): ScheduleAgentOutput {
        val unplaced = if (calls++ == 0) first else second
        return ScheduleAgentOutput(
            days = input.timeWindows.map { DaySchedule(it.date, emptyList()) },
            day1ReadyAt = null, explanations = emptyMap(),
            solveMode = SolveMode.DETERMINISTIC, isFallback = false,
            freshness = FreshnessMeta(now, degraded = false),
            unplacedMustVisits = unplaced,
        )
    }
    override fun validate(solution: ScheduleAgentOutput): List<Violation> = emptyList()
    override fun repair(solution: ScheduleAgentOutput, violations: List<Violation>) = RepairResult(solution, emptyList())
    override fun explanations(tripId: UUID, solution: ScheduleAgentOutput): Map<String, String> = emptyMap()
}

private class CapturingAgent(private val now: Instant, private val emit: (LocalDate) -> List<VisitSlotDisplay> = { emptyList() }) :
    StubScheduleAgent() {
    val captures = mutableListOf<ScheduleAgentInput>()
    val captured: ScheduleAgentInput? get() = captures.firstOrNull()
    override fun generate(input: ScheduleAgentInput): ScheduleAgentOutput {
        captures += input
        return ScheduleAgentOutput(
            days = input.timeWindows.map { DaySchedule(it.date, emit(it.date)) },
            day1ReadyAt = null, explanations = emptyMap(),
            solveMode = SolveMode.DETERMINISTIC, isFallback = false,
            freshness = FreshnessMeta(now, degraded = false),
        )
    }
    override fun validate(solution: ScheduleAgentOutput): List<Violation> = emptyList()
    override fun repair(solution: ScheduleAgentOutput, violations: List<Violation>) = RepairResult(solution, emptyList())
    override fun explanations(tripId: UUID, solution: ScheduleAgentOutput): Map<String, String> = emptyMap()
}

/** ScheduleAgent(AI) 실패 재현 — INV-4 폴백 경로 검증용. */
private class ThrowingAgent : StubScheduleAgent() {
    override fun generate(input: ScheduleAgentInput): ScheduleAgentOutput = throw RuntimeException("agent down")
    override fun validate(solution: ScheduleAgentOutput): List<Violation> = emptyList()
    override fun repair(solution: ScheduleAgentOutput, violations: List<Violation>) = RepairResult(solution, emptyList())
    override fun explanations(tripId: UUID, solution: ScheduleAgentOutput): Map<String, String> = emptyMap()
}

private class CapturingPublisher : DomainEventPublisher {
    val published = mutableListOf<DomainEvent>()
    override fun publish(event: DomainEvent) { published += event }
}

/** 콜백을 그대로 실행하는 no-op tx 매니저(단위 테스트용 — 실 tx 없이 TransactionTemplate 통과). */
private val NOOP_TX = object : PlatformTransactionManager {
    override fun getTransaction(definition: TransactionDefinition?): TransactionStatus = SimpleTransactionStatus()
    override fun commit(status: TransactionStatus) {}
    override fun rollback(status: TransactionStatus) {}
}

/** 테스트용 리비전 서비스 조립 — 생성 경로가 되돌리기 지점을 남기는지 보려면 실물이 필요하다. */
internal val stubTrips = object : TripFacade {
    override fun findPeriod(accountId: UUID, tripId: UUID) =
        TripPeriod(LocalDate.parse("2026-08-01"), LocalDate.parse("2026-08-03"))
    override fun findGenerationContext(accountId: UUID, tripId: UUID) = null
}

internal fun genRevisions(repo: ItineraryRepository, trips: TripFacade, clock: Clock = Clock.fixed(Instant.parse("2026-07-25T00:00:00Z"), ZoneOffset.UTC)) =
    ItineraryRevisionService(GenFakeRevisions(), repo, trips, NoopValidateAgent(), NOOP_TX, clock)

/** 리비전 기록을 관찰하는 인메모리 저장소 — seq 는 순서대로 부여. */
private class GenFakeRevisions : ItineraryRevisionRepository {
    val appended = mutableListOf<NewRevision>()
    override fun append(revision: NewRevision): ItineraryRevision {
        appended += revision
        return ItineraryRevision(
            UUID.randomUUID(), revision.tripId, revision.itineraryId, appended.size, revision.actor, revision.kind,
            revision.summary, revision.detail, revision.snapshot, revision.createdAt,
        )
    }
    override fun findSummaries(tripId: UUID, limit: Int) =
        appended.filter { it.tripId == tripId }.mapIndexed { i, r ->
            ItineraryRevisionSummary(UUID.randomUUID(), i + 1, r.actor, r.kind, r.summary, r.detail, r.createdAt)
        }.takeLast(limit).reversed()
    override fun existsForTrip(tripId: UUID) = appended.any { it.tripId == tripId }
    override fun findById(revisionId: UUID): ItineraryRevision? = null
}

/** 상태를 들고 있는 인메모리 저장소 — 2차 생성이 PARTIAL 을 다시 읽어 전이하므로 무상태 스텁으론 부족하다. */
private open class FakeItineraries : ItineraryRepository {
    val byTrip = mutableMapOf<UUID, Itinerary>()
    open override fun save(itinerary: Itinerary): Itinerary = itinerary.also { byTrip[it.tripId] = it }
    open override fun findById(itineraryId: UUID): Itinerary? = byTrip.values.firstOrNull { it.itineraryId == itineraryId }
    open override fun findByTrip(tripId: UUID): List<Itinerary> = listOfNotNull(byTrip[tripId])
    open override fun replaceForTrip(tripId: UUID, itinerary: Itinerary): Itinerary = itinerary.also { byTrip[tripId] = it }
    override fun replaceIfCurrent(tripId: UUID, expectedItineraryId: UUID, itinerary: Itinerary): Boolean {
        val current = byTrip[tripId] ?: return false
        if (current.itineraryId != expectedItineraryId || current.generationState != GenerationState.PARTIAL) return false
        replaceForTrip(tripId, itinerary)
        return true
    }
    override fun findStalePartial(updatedBefore: Instant): List<Itinerary> =
        byTrip.values.filter { it.generationState == GenerationState.PARTIAL && it.updatedAt < updatedBefore }

}

/**
 * 컨텍스트 조립 검증 — 캡처 에이전트로 ScheduleAgentInput 을 붙잡아 취향(7축)·budgetLevel·앵커 조립을 고정.
 * 앵커 체크아웃일(endDate)=전날 거점(prev_stay) 파생·미해결일 제외를 포함.
 */
class GenerateItineraryServiceTest : StringSpec({

    val now = Instant.parse("2026-07-25T00:00:00Z")
    val clock = Clock.fixed(now, ZoneOffset.UTC)
    val acc = UUID.randomUUID()
    val tripId = UUID.randomUUID()
    val poi = UUID.randomUUID()
    val start = LocalDate.parse("2026-08-01")
    val defaultEnd = LocalDate.parse("2026-08-03") // 계획일 08-01·02·03, 숙박일 08-01·02
    val end = defaultEnd

    fun service(
        agent: ScheduleAgentPort,
        prefs: PreferenceSnapshot,
        anchors: List<DayAnchorView>,
        publisher: DomainEventPublisher = CapturingPublisher(),
        repo: FakeItineraries = FakeItineraries(),
        sessionRepo: FakeGenerationSessions = FakeGenerationSessions(),
        end: LocalDate = defaultEnd,
        fixedVisits: List<FixedVisit> = listOf(FixedVisit(poi, start, LocalTime.parse("12:00"), 90)),
        destinations: List<String> = listOf("제주"),
        clock: Clock = Clock.fixed(now, ZoneOffset.UTC),
    ): GenerateItineraryService {
        val trips = object : TripFacade {
            override fun findPeriod(accountId: UUID, tripId: UUID) = TripPeriod(start, end)
            @Suppress("UNUSED_PARAMETER")
            override fun findGenerationContext(accountId: UUID, tripId: UUID) =
                if (accountId == acc) {
                    TripGenerationContext(
                        start, end, destinations, "친구", 500_000, fixedVisits,
                    )
                } else {
                    null
                }
        }
        val preferences = object : PreferenceFacade {
            override fun findPreferences(accountId: UUID) = prefs
        }
        val baseAnchors = object : BaseAnchorFacade {
            override fun findStayNightAnchors(tripId: UUID, startDate: LocalDate, endDate: LocalDate) = anchors
        }
        // 단위 테스트엔 Spring 프록시가 없어 @Async 가 걸리지 않는다 → 2차가 그 자리에서 동기 실행된다(결정론).
        // 1차·2차가 **같은 세션**을 봐야 취소가 2차에 전달된다 — 인스턴스를 나누면 취소가 사라진다.
        val sessions = genSessions(trips, sessionRepo, clock, defaultDeadlines)
        val second = SecondPhaseGenerator(agent, repo, genRevisions(repo, trips), sessions, NOOP_TX, clock)
        return GenerateItineraryService(trips, preferences, baseAnchors, agent, repo, publisher, second, sessions, genRevisions(repo, trips), StubRegions, NOOP_TX, clock, defaultDeadlines)
    }

    val fullPrefs = PreferenceSnapshot(
        styles = listOf("미식"), activities = listOf("야경"), foodTastes = listOf("한식"),
        transportModes = listOf("렌터카"), pace = "알차게", companionTypes = listOf("친구"),
        petFriendly = true, budgetTier = "고급",
    )

    "취향 7축·budgetLevel(=budget_tier)·must_visit 고정블록 조립" {
        val agent = CapturingAgent(now)
        service(agent, fullPrefs, emptyList()).generate(acc, tripId, GenerationMode.FULLY_AI)
        val input = agent.captured!!
        input.tripContext.budgetLevel shouldBe "고급"
        input.preferenceProfile.styles shouldBe listOf("미식")
        input.preferenceProfile.transportModes shouldBe listOf("렌터카")
        input.preferenceProfile.petFriendly shouldBe true
        input.timeWindows.map { it.date } shouldContainExactly listOf(start) // 1차 = day1 만
        input.fixedBlocks.single().poiId shouldBe poi
        agent.captures[1].timeWindows.map { it.date } shouldContainExactly listOf(start.plusDays(1), end) // 2차 = 나머지
    }

    "날짜 미지정(ANYTIME) 필수 방문지는 2차에 실린다 — 하루짜리 1차에 몰면 배치 공간이 없다" {
        val anytime = UUID.randomUUID()
        val agent = CapturingAgent(now)
        service(
            agent, fullPrefs, emptyList(),
            fixedVisits = listOf(
                FixedVisit(poi, start, LocalTime.parse("12:00"), 90), // 날짜 지정 → 1차(그 날짜가 1차 몫)
                FixedVisit(anytime, null, null, null),                // ANYTIME → 2차
            ),
        ).generate(acc, tripId, GenerationMode.FULLY_AI)

        agent.captures[0].fixedBlocks.map { it.poiId } shouldContainExactly listOf(poi)
        agent.captures[1].fixedBlocks.map { it.poiId } shouldContainExactly listOf(anytime)
    }

    "ANYTIME 은 물질화돼 경계로 나간다 (M1) — null 이 하나라도 나가면 요청 전체가 422 다" {
        val anytime = UUID.randomUUID()
        val agent = CapturingAgent(now)
        service(agent, fullPrefs, emptyList(), fixedVisits = listOf(FixedVisit(anytime, null, null, null)))
            .generate(acc, tripId, GenerationMode.FULLY_AI)

        val block = agent.captures[1].fixedBlocks.single { it.poiId == anytime }
        block.date shouldBe null.let { _ -> block.date } // 아래 두 줄이 본질
        (block.date != null) shouldBe true
        (block.start != null) shouldBe true
    }

    "!(M1 물질화로 전제 소멸) 다일 여행에서 ANYTIME 때문에 2차가 거부돼도 day1 은 살아남는다" {
        // 통합테스트에서 무엇을 보게 되는지 못 박는다 — '여행 전체가 폴백'이 아니라
        // **day1 은 실 AI 결과, 나머지 일자만 MINIMAL** 이고 상태는 COMPLETE(isFallback=true) 다.
        // 단일일 여행은 ANYTIME 이 1차에 실려 전체가 MINIMAL 이 된다(carriesUndatedFixed).
        val anytime = UUID.randomUUID()
        val emitted = UUID.randomUUID()
        val agent = RejectAnytimeAgent(now, emitted)
        val repo = FakeItineraries()
        service(agent, fullPrefs, emptyList(), repo = repo, fixedVisits = listOf(FixedVisit(anytime, null, null, null)))
            .generate(acc, tripId, GenerationMode.FULLY_AI)

        val saved = repo.findByTrip(tripId).single()
        saved.generationState shouldBe GenerationState.COMPLETE // FAILED 가 아니다 — 폴백으로 채워졌다
        saved.isFallback shouldBe true
        saved.solveMode shouldBe SolveMode.MINIMAL
        saved.days.first().slots.map { it.sourcePoiId } shouldContainExactly listOf(emitted) // day1 = 실 AI 결과 보존
    }

    "AI 가 보고한 미배치 필수 방문지가 일정에 실린다 — 안 실으면 재조회에서 사라진다(계약 M2)" {
        val missed = UUID.randomUUID()
        val agent = ReportingAgent(now, listOf(UnplacedMustVisit(missed, UnplacedReason.OUT_OF_RANGE)))
        val repo = FakeItineraries()
        service(agent, fullPrefs, emptyList(), repo = repo).generate(acc, tripId, GenerationMode.FULLY_AI)

        val saved = repo.findByTrip(tripId).single()
        saved.unplacedMustVisits.single().poiId shouldBe missed
        saved.unplacedMustVisits.single().reasonCode shouldBe UnplacedReason.OUT_OF_RANGE
    }

    "2차 보고가 최종이다 — 1차(day1만) 판정으로 되돌리지 않는다" {
        // 1차는 day1 만 보고 판정하므로 "못 넣었다"가 나올 수 있지만, 2차가 전 일자를 보고 넣었을 수 있다.
        // 1차 값을 유지하면 사용자는 이미 들어간 장소를 '못 넣었다'고 보게 된다.
        val missed = UUID.randomUUID()
        val agent = TwoPhaseReportingAgent(now, first = listOf(UnplacedMustVisit(missed, UnplacedReason.NO_FEASIBLE_SLOT)), second = emptyList())
        val repo = FakeItineraries()
        service(agent, fullPrefs, emptyList(), repo = repo).generate(acc, tripId, GenerationMode.FULLY_AI)

        repo.findByTrip(tripId).single().unplacedMustVisits shouldBe emptyList()
    }

    "앵커: 숙박일=거점 좌표, 체크아웃일=전날 거점(prev_stay)" {
        val agent = CapturingAgent(now)
        val anchors = listOf(
            DayAnchorView(start, 37.5, 127.0),               // 08-01
            DayAnchorView(start.plusDays(1), 35.1, 129.0),   // 08-02
        )
        service(agent, fullPrefs, anchors).generate(acc, tripId, GenerationMode.FULLY_AI)
        // 각 호출은 자기가 맡은 일자의 앵커만 받는다(1차=day1, 2차=나머지).
        agent.captures[0].anchors.map { it.date } shouldContainExactly listOf(start)
        val second = agent.captures[1].anchors
        second.map { it.date } shouldContainExactly listOf(start.plusDays(1), end)
        second.first { it.date == end }.lat shouldBe 35.1 // 체크아웃일 08-03 = 전날(08-02) 거점
    }

    "취향 미설정이면 빈 취향·null budgetLevel" {
        val agent = CapturingAgent(now)
        val empty = PreferenceSnapshot(emptyList(), emptyList(), emptyList(), emptyList(), null, emptyList(), false, null)
        service(agent, empty, emptyList()).generate(acc, tripId, GenerationMode.FULLY_AI)
        agent.captured!!.tripContext.budgetLevel shouldBe null
        agent.captured!!.preferenceProfile.styles shouldBe emptyList()
        // 앵커는 이 테스트의 관심사가 아니다 — 예전엔 거점이 없으면 비었는데, 지금은 목적지 중심이
        // 채운다(TRIP-384). 취향과 무관한 단언이라 여기서 뺀다(전용 테스트가 따로 있다).
    }

    "생성 시 ItineraryGenerated 이벤트 발행(TRIP-230)" {
        val publisher = CapturingPublisher()
        val result = service(CapturingAgent(now), fullPrefs, emptyList(), publisher).generate(acc, tripId, GenerationMode.FULLY_AI)
        val event = publisher.published.filterIsInstance<ItineraryGenerated>().single()
        event.aggregateId shouldBe result.itineraryId.toString()
        event.tripId shouldBe tripId.toString()
        event.isFallback shouldBe false
    }

    "ScheduleAgent 실패 시 결정론 최소 폴백(INV-4) — isFallback·MINIMAL·고정블록 보존" {
        val result = service(ThrowingAgent(), fullPrefs, emptyList()).generate(acc, tripId, GenerationMode.FULLY_AI)
        result.isFallback shouldBe true
        result.solveMode shouldBe SolveMode.MINIMAL
        // must_visit 고정 블록(08-01 12:00)은 폴백에도 보존
        val day0 = result.days.first { it.date == start }
        day0.slots.single().let {
            it.sourcePoiId shouldBe poi
            it.isFixed shouldBe true
        }
    }
    // ── 재생성 가드(여행 기간) ──────────────────────────────────────────────
    //
    // 재생성은 기존 일정을 지우고 새로 만든다. 여행 중에 그러면 따라가던 계획이 통째로 갈리고
    // **방문 실적이 유령이 된다** — visit_check 는 trip_id+slotKey 로 남아 삭제를 견딘다.
    // 여행 중 변경은 재계획(Plan-B)의 몫이다.
    //
    // **첫 생성은 대상이 아니다** — 지울 계획이 없으면 이 피해가 성립하지 않는다. 그래서 아래 케이스들은
    // 기존 일정을 미리 깔고 시작한다(그게 "재생성"의 정의다).

    fun clockAt(day: String): Clock = Clock.fixed(Instant.parse("${day}T00:00:00Z"), ZoneOffset.UTC)

    /** 이미 일정이 있는 상태 — 재생성 경로로 들어가게 한다. */
    fun repoWithExisting(): FakeItineraries = FakeItineraries().apply {
        byTrip[tripId] = Itinerary.create(
            tripId, SolveMode.FULL_AI, GenerationMode.FULLY_AI, false,
            listOf(ItineraryDay.of(start, 0, emptyList())),
            now, GenerationState.COMPLETE,
        )
    }

    "여행 시작 전이면 재생성된다" {
        val svc = service(CapturingAgent(now), fullPrefs, emptyList(), repo = repoWithExisting(), clock = clockAt("2026-07-31"))

        svc.generate(acc, tripId, GenerationMode.FULLY_AI).tripId shouldBe tripId
    }

    // 경계값 — 시작 당일은 이미 "여행 중"이다. 첫날 아침에 통째로 다시 짜면 그날 일정이 사라진다.
    "여행 시작 당일이면 409" {
        val svc = service(CapturingAgent(now), fullPrefs, emptyList(), repo = repoWithExisting(), clock = clockAt("2026-08-01"))

        shouldThrow<ConflictDetected> { svc.generate(acc, tripId, GenerationMode.FULLY_AI) }
            .message.orEmpty() shouldContain "재계획"
    }

    "여행 중이면 409" {
        val svc = service(CapturingAgent(now), fullPrefs, emptyList(), repo = repoWithExisting(), clock = clockAt("2026-08-02"))

        shouldThrow<ConflictDetected> { svc.generate(acc, tripId, GenerationMode.FULLY_AI) }
    }

    // 경계값 — 마지막 날도 여행 중이다(체크아웃일까지 계획일에 포함된다).
    "여행 마지막 날이면 409" {
        val svc = service(CapturingAgent(now), fullPrefs, emptyList(), repo = repoWithExisting(), clock = clockAt("2026-08-03"))

        shouldThrow<ConflictDetected> { svc.generate(acc, tripId, GenerationMode.FULLY_AI) }
    }

    "끝난 여행이면 409 — 문구가 다르다" {
        val svc = service(CapturingAgent(now), fullPrefs, emptyList(), repo = repoWithExisting(), clock = clockAt("2026-08-04"))

        shouldThrow<ConflictDetected> { svc.generate(acc, tripId, GenerationMode.FULLY_AI) }
            .message.orEmpty() shouldContain "끝난 여행"
    }

    // 직접 만들기도 같은 가드를 지난다 — AI 를 안 부를 뿐 기존 일정을 지우는 것은 똑같다.
    /**
     * 2차 생성이 중단되면 스위퍼가 `FAILED` 로 내리되 **일정 행은 남긴다**. 그 행 때문에 여행 중
     * 재생성이 막히면 사용자는 1일차만 있는 반쪽 일정에 갇힌다 — 실패한 생성은 지킬 계획이 아니다.
     */
    "실패한 일정은 여행 중에도 다시 만들 수 있다" {
        val failedRepo = FakeItineraries().apply {
            byTrip[tripId] = Itinerary.create(
                tripId, SolveMode.FULL_AI, GenerationMode.FULLY_AI, false,
                listOf(ItineraryDay.of(start, 0, emptyList())),
                now, GenerationState.FAILED,
            )
        }
        val svc = service(CapturingAgent(now), fullPrefs, emptyList(), repo = failedRepo, clock = clockAt("2026-08-02"))

        svc.generate(acc, tripId, GenerationMode.FULLY_AI).tripId shouldBe tripId
    }

    "직접 만들기도 여행 중이면 409" {
        val svc = service(CapturingAgent(now), fullPrefs, emptyList(), repo = repoWithExisting(), clock = clockAt("2026-08-02"))

        shouldThrow<ConflictDetected> { svc.generate(acc, tripId, GenerationMode.MANUAL) }
    }
    /**
     * **숙소를 하나도 등록하지 않아도 앵커가 생긴다**(TRIP-384).
     *
     * 예전에는 거점 없는 날을 앵커에서 뺐다. 숙소가 0개면 앵커가 **전부** 비고, AI 가 요청을 422 로
     * 거절한다("anchors 최소 1개 필요"). 백엔드는 그 실패를 폴백으로 받지만 폴백은 must_visit 만으로
     * 일정을 만들어, 필수 방문지가 없으면 **일정이 통째로 빈 채** 201 로 나갔다.
     *
     * 정본은 숙소 없는 생성을 허용한다(BR-U1-40 · BR-U1-47 · US-SCHED-11).
     */
    "숙소가 없어도 목적지 중심이 앵커로 들어간다" {
        val agent = CapturingAgent(now)
        val svc = service(agent, fullPrefs, anchors = emptyList(), fixedVisits = emptyList())

        svc.generate(acc, tripId, GenerationMode.FULLY_AI)

        val sent = agent.captured!!
        sent.anchors.isEmpty() shouldBe false
        sent.anchors.all { a -> a.lat == 33.4996 && a.lng == 126.5312 } shouldBe true
    }

    /** 목적지 좌표조차 없으면 앵커를 지어내지 않는다 — 없는 것을 있다고 말하지 않는다. */
    "목적지 좌표가 없으면 앵커도 비운다" {
        val agent = CapturingAgent(now)
        val svc = service(agent, fullPrefs, anchors = emptyList(), fixedVisits = emptyList(),
                          destinations = listOf("좌표없는곳"))

        svc.generate(acc, tripId, GenerationMode.FULLY_AI)

        agent.captured!!.anchors.isEmpty() shouldBe true
    }

})

/** day1 조기 노출 2단계(TRIP-267) — 1차 즉시 반환(PARTIAL) · 2차 백그라운드 완료(COMPLETE). */
class GenerateItineraryTwoPhaseTest : StringSpec({

    val now = Instant.parse("2026-07-25T00:00:00Z")
    val clock = Clock.fixed(now, ZoneOffset.UTC)
    val acc = UUID.randomUUID()
    val tripId = UUID.randomUUID()
    val start = LocalDate.parse("2026-08-01")

    val prefs = PreferenceSnapshot(emptyList(), emptyList(), emptyList(), emptyList(), null, emptyList(), false, null)

    /** 일자마다 그 날짜 전용 POI 하나를 배정하는 에이전트 — 제외 목록 전파를 관찰하려면 실제 배정이 있어야 한다. */
    fun emittingAgent(end: LocalDate): Pair<CapturingAgent, Map<LocalDate, UUID>> {
        val poiByDate = generateSequence(start) { it.plusDays(1) }.takeWhile { !it.isAfter(end) }
            .associateWith { UUID.randomUUID() }
        val agent = CapturingAgent(now) { date ->
            listOf(VisitSlotDisplay(poiByDate.getValue(date), LocalTime.parse("10:00"), LocalTime.parse("11:00"), false, null, isFixed = false))
        }
        return agent to poiByDate
    }

    /** 2차 입력 최소 구성 — 경합 테스트는 입력 내용이 아니라 "반영 여부"만 본다. */
    fun agentInputFor(end: LocalDate) = ScheduleAgentInput(
        tripId = tripId,
        generationMode = GenerationMode.FULLY_AI,
        tripContext = TripContext(listOf("제주"), start, end, "친구", null),
        anchors = emptyList(),
        timeWindows = listOf(TimeWindow(end, LocalTime.parse("09:00"), LocalTime.parse("21:00"))),
        fixedBlocks = emptyList(),
        preferenceProfile = PreferenceProfile(emptyList(), emptyList(), emptyList(), emptyList(), null, emptyList(), false, null),
        recommendationStrength = null,
        requestMeta = RequestMeta(UUID.randomUUID().toString(), now, 20_000L),
    )

    fun service(
        agent: ScheduleAgentPort,
        repo: FakeItineraries,
        end: LocalDate,
        sessionRepo: FakeGenerationSessions = FakeGenerationSessions(),
        // 기본값 인자는 **맨 뒤에** 둔다 — 중간에 끼우면 위치 인자로 부르는 호출이 조용히 어긋난다.
        deadlines: ScheduleDeadlineProperties = defaultDeadlines,
    ): GenerateItineraryService {
        val trips = object : TripFacade {
            override fun findPeriod(accountId: UUID, tripId: UUID) = TripPeriod(start, end)
            override fun findGenerationContext(accountId: UUID, tripId: UUID) =
                TripGenerationContext(start, end, listOf("제주"), "친구", 500_000, emptyList())
        }
        val preferences = object : PreferenceFacade {
            override fun findPreferences(accountId: UUID) = prefs
        }
        val baseAnchors = object : BaseAnchorFacade {
            override fun findStayNightAnchors(tripId: UUID, startDate: LocalDate, endDate: LocalDate) = emptyList<DayAnchorView>()
        }
        // 1차·2차가 **같은 세션**을 봐야 취소가 2차에 전달된다.
        val sessions = genSessions(trips, sessionRepo, clock, deadlines)
        val second = SecondPhaseGenerator(agent, repo, genRevisions(repo, trips), sessions, NOOP_TX, clock)
        return GenerateItineraryService(trips, preferences, baseAnchors, agent, repo, CapturingPublisher(), second, sessions, genRevisions(repo, trips), StubRegions, NOOP_TX, clock, deadlines)
    }

    "추천 근거가 slotKey 로 슬롯에 붙어 영속된다(TRIP-306 · BR-U2-04)" {
        val poi = UUID.randomUUID()
        val agent = object : StubScheduleAgent() {
            override fun generate(input: ScheduleAgentInput) = ScheduleAgentOutput(
                days = input.timeWindows.map { tw ->
                    DaySchedule(tw.date, listOf(VisitSlotDisplay(poi, LocalTime.parse("10:00"), LocalTime.parse("11:00"), false, null, isFixed = false)))
                },
                day1ReadyAt = null,
                // 키 규약 = "{date}#{poiId}" — 어긋나면 근거가 슬롯에 안 붙고 조용히 빈 값이 된다
                explanations = mapOf("$start#$poi" to "취향(미식)과 동선에 맞는 곳"),
                solveMode = SolveMode.DETERMINISTIC, isFallback = false,
                freshness = FreshnessMeta(now, degraded = false),
                candidatesSummary = com.trippilot.itinerarygeneration.domain.CandidatesSummary("LOW", 7, listOf("CAFE")),
            )
            override fun validate(solution: ScheduleAgentOutput): List<Violation> = emptyList()
            override fun repair(solution: ScheduleAgentOutput, violations: List<Violation>) = RepairResult(solution, emptyList())
            override fun explanations(tripId: UUID, solution: ScheduleAgentOutput): Map<String, String> = emptyMap()
        }
        val repo = FakeItineraries()
        val returned = service(agent, repo, start).generate(acc, tripId, GenerationMode.FULLY_AI)

        returned.days.single().slots.single().placementReason shouldBe "취향(미식)과 동선에 맞는 곳"
        // 후보 요약은 AI 값 그대로 — 백엔드가 등급을 재계산하지 않는다
        returned.candidatesSummary!!.level shouldBe "LOW"
        returned.candidatesSummary!!.poolSize shouldBe 7
        returned.candidatesSummary!!.shortfallCategories shouldBe listOf("CAFE")
    }

    "직접 만들기(MANUAL)는 AI 를 아예 부르지 않고 빈 일자만 만든다" {
        val end = start.plusDays(2)
        val (agent, _) = emittingAgent(end)
        val repo = FakeItineraries()
        val result = service(agent, repo, end).generate(acc, tripId, GenerationMode.MANUAL)

        agent.captures shouldBe emptyList()          // 경계에 닿지 않는다 — 상대 enum 에 MANUAL 이 없어 422 다
        result.days.map { it.date } shouldContainExactly listOf(start, start.plusDays(1), end)
        result.days.all { it.slots.isEmpty() } shouldBe true
        result.generationState shouldBe GenerationState.COMPLETE   // 2차를 기다리지 않는다
        result.generationMode shouldBe GenerationMode.MANUAL
    }

    "직접 만들기는 폴백이 아니다 — isFallback 을 켜면 화면이 AI 실패로 오해한다" {
        val (agent, _) = emittingAgent(start)
        val result = service(agent, FakeItineraries(), start).generate(acc, tripId, GenerationMode.MANUAL)
        result.isFallback shouldBe false
        result.solveMode shouldBe SolveMode.MINIMAL   // AI 산출물이 아니라는 표시
    }

    "AI 방식에서 직접 만들기로 전환하면 빈 일정으로 교체된다" {
        val end = start.plusDays(1)
        val (agent, _) = emittingAgent(end)
        val repo = FakeItineraries()
        service(agent, repo, end).generate(acc, tripId, GenerationMode.FULLY_AI)
        repo.byTrip.getValue(tripId).days.any { it.slots.isNotEmpty() } shouldBe true

        service(agent, repo, end).generate(acc, tripId, GenerationMode.MANUAL)
        val switched = repo.byTrip.getValue(tripId)
        switched.generationMode shouldBe GenerationMode.MANUAL
        switched.days.all { it.slots.isEmpty() } shouldBe true
        // 전환 전 일정으로 되돌아가는 것은 리비전(TRIP-310)이 담당한다 — 여기서는 전환 자체만 본다.
    }

    "다일 여행: 반환은 day1 만·PARTIAL, 2차 완료 후 전 일자·COMPLETE" {
        val end = start.plusDays(2)
        val (agent, _) = emittingAgent(end)
        val repo = FakeItineraries()
        val returned = service(agent, repo, end).generate(acc, tripId, GenerationMode.FULLY_AI)

        // 사용자에게 즉시 돌려주는 값 = day1 만, 아직 생성 중
        returned.generationState shouldBe GenerationState.PARTIAL
        returned.days.map { it.date } shouldContainExactly listOf(start)

        // 2차가 끝난 뒤 저장본 = 전 일자, dayOrder 연속
        val finished = repo.byTrip.getValue(tripId)
        finished.generationState shouldBe GenerationState.COMPLETE
        finished.days.map { it.date } shouldContainExactly listOf(start, start.plusDays(1), end)
        finished.days.map { it.dayOrder } shouldContainExactly listOf(0, 1, 2)
        finished.itineraryId shouldBe returned.itineraryId // 같은 일정을 이어 채운다(교체 아님)
    }

    "2차 일자에도 추천 근거가 붙는다(1차만 테스트하면 이 경로가 비어 있다)" {
        val end = start.plusDays(2)
        val poiByDate = generateSequence(start) { it.plusDays(1) }.takeWhile { !it.isAfter(end) }.associateWith { UUID.randomUUID() }
        val agent = object : StubScheduleAgent() {
            override fun generate(input: ScheduleAgentInput) = ScheduleAgentOutput(
                days = input.timeWindows.map { tw ->
                    DaySchedule(tw.date, listOf(VisitSlotDisplay(poiByDate.getValue(tw.date), LocalTime.parse("10:00"), LocalTime.parse("11:00"), false, null, isFixed = false)))
                },
                day1ReadyAt = null,
                // 생성은 더 이상 근거를 싣지 않는다(TRIP-511) — 아래 explanations 가 준다.
                explanations = emptyMap(),
                solveMode = SolveMode.DETERMINISTIC, isFallback = false,
                freshness = FreshnessMeta(now, degraded = false),
            )

            override fun explanations(tripId: UUID, solution: ScheduleAgentOutput) =
                poiByDate.entries.associate { (d, p) -> "$d#$p" to "$d 근거" }
            override fun validate(solution: ScheduleAgentOutput): List<Violation> = emptyList()
            override fun repair(solution: ScheduleAgentOutput, violations: List<Violation>) = RepairResult(solution, emptyList())
        }
        val repo = FakeItineraries()
        service(agent, repo, end).generate(acc, tripId, GenerationMode.FULLY_AI)

        val finished = repo.byTrip.getValue(tripId)
        finished.days.map { d -> d.slots.single().placementReason } shouldContainExactly
            listOf("$start 근거", "${start.plusDays(1)} 근거", "$end 근거")
    }

    "2차는 1차 배정 POI 를 excludedPoiIds 로 제외(TRIP-293)" {
        val end = start.plusDays(2)
        val (agent, poiByDate) = emittingAgent(end)
        service(agent, FakeItineraries(), end).generate(acc, tripId, GenerationMode.FULLY_AI)

        agent.captures[0].excludedPoiIds shouldBe emptyList()             // 1차엔 제외 없음
        agent.captures[1].excludedPoiIds shouldContainExactly listOf(poiByDate.getValue(start))
    }

    /**
     * **기본은 시한을 싣지 않는다**(TRIP-474). AI 계약상 미지정 = 시간제약 없음이라,
     * 값을 실으면 시간 때문에 규칙 폴백으로 강등되는 경로가 도로 열린다.
     */
    "기본 설정에서는 시한을 싣지 않는다" {
        val end = start.plusDays(2)
        val (agent, _) = emittingAgent(end)
        service(agent, FakeItineraries(), end).generate(acc, tripId, GenerationMode.FULLY_AI)

        agent.captures[0].requestMeta.deadlineMs shouldBe null
        agent.captures[1].requestMeta.deadlineMs shouldBe null
    }

    /**
     * **재도입은 플래그 한 줄이다**(TRIP-475 9월 예정). 값을 지우지 않고 끈 이유가 이것이므로,
     * 켰을 때 종전과 같은 값이 나가는지 지금 고정해 둔다 — 나중에 확인하면 이미 늦다.
     */
    "플래그를 켜면 1차 day1 예산(5s), 2차 전체 예산(20s) 그대로다" {
        val end = start.plusDays(2)
        val (agent, _) = emittingAgent(end)
        service(agent, FakeItineraries(), end, deadlines = ScheduleDeadlineProperties(enforced = true))
            .generate(acc, tripId, GenerationMode.FULLY_AI)

        agent.captures[0].requestMeta.deadlineMs shouldBe 5_000L
        agent.captures[1].requestMeta.deadlineMs shouldBe 20_000L
    }

    /**
     * **근거는 생성 호출에 실리지 않는다**(TRIP-511) — 실리면 첫 화면이 LLM(~10초)을 기다린다.
     * 1차·2차 **둘 다** 꺼야 한다: 한쪽만 끄면 절반의 지연이 그대로 남는다.
     */
    "생성 호출은 근거를 요청하지 않는다 — 1차·2차 모두" {
        val end = start.plusDays(2)
        val (agent, _) = emittingAgent(end)

        service(agent, FakeItineraries(), end).generate(acc, tripId, GenerationMode.FULLY_AI)

        agent.captures.map { it.includeExplanations } shouldContainExactly listOf(false, false)
    }

    /**
     * **근거가 COMPLETE 시점에 들어 있다**(TRIP-511).
     *
     * 화면은 `PARTIAL` 이 아니게 되는 순간 폴링을 멈춘다. 근거를 COMPLETE **뒤에** 채우면
     * 도착해도 영영 못 본다 — 그래서 "다 됐다"의 뜻에 근거가 포함돼야 한다.
     * day1 은 1차 응답에 근거가 없었으므로, 이 테스트는 **뒤늦게 채워졌는지**까지 함께 본다.
     */
    "COMPLETE 가 될 때 day1 을 포함한 전 일자에 근거가 들어 있다" {
        val end = start.plusDays(2)
        val poiByDate = generateSequence(start) { it.plusDays(1) }.takeWhile { !it.isAfter(end) }
            .associateWith { UUID.randomUUID() }
        val agent = object : StubScheduleAgent() {
            override fun generate(input: ScheduleAgentInput) = ScheduleAgentOutput(
                days = input.timeWindows.map { tw ->
                    DaySchedule(tw.date, listOf(VisitSlotDisplay(poiByDate.getValue(tw.date), LocalTime.parse("10:00"), LocalTime.parse("11:00"), false, null, isFixed = false)))
                },
                day1ReadyAt = null, explanations = emptyMap(),
                solveMode = SolveMode.DETERMINISTIC, isFallback = false,
                freshness = FreshnessMeta(now, degraded = false),
            )
            override fun explanations(tripId: UUID, solution: ScheduleAgentOutput) =
                solution.days.flatMap { d -> d.slots.map { "${d.date}#${it.poiId}" to "${d.date} 근거" } }.toMap()
            override fun validate(solution: ScheduleAgentOutput): List<Violation> = emptyList()
            override fun repair(solution: ScheduleAgentOutput, violations: List<Violation>) = RepairResult(solution, emptyList())
        }
        val repo = FakeItineraries()

        val returned = service(agent, repo, end).generate(acc, tripId, GenerationMode.FULLY_AI)

        returned.days.single().slots.single().placementReason shouldBe null // 1차 응답에는 아직 없다
        val finished = repo.byTrip.getValue(tripId)
        finished.generationState shouldBe GenerationState.COMPLETE
        finished.days.map { it.slots.single().placementReason } shouldContainExactly
            listOf("$start 근거", "${start.plusDays(1)} 근거", "$end 근거")
    }

    /** 근거 조회가 빈 맵을 줘도 일정은 닫힌다 — 근거는 부가 정보라 없다고 생성을 죽이지 않는다(INV-4). */
    "근거가 비어도 일정은 COMPLETE 로 닫힌다" {
        val end = start.plusDays(1)
        val (agent, _) = emittingAgent(end) // 이 대역의 근거 조회는 빈 맵이다
        val repo = FakeItineraries()

        service(agent, repo, end).generate(acc, tripId, GenerationMode.FULLY_AI)

        val finished = repo.byTrip.getValue(tripId)
        finished.generationState shouldBe GenerationState.COMPLETE
        finished.days.flatMap { it.slots }.all { it.placementReason == null } shouldBe true
    }

    /**
     * **하루 여행도 마무리를 거친다**(TRIP-511) — 2차 생성은 없지만 추천 근거는 받아야 한다.
     * 돌려주는 값은 PARTIAL 이고, 마무리가 끝나면 저장본이 COMPLETE 다. 여기서 즉시 COMPLETE 로
     * 닫으면 화면이 폴링을 멈춰 근거가 도착해도 못 본다.
     */
    "단일일 여행: 2차 생성은 없지만 마무리를 거쳐 COMPLETE 가 된다" {
        val repo = FakeItineraries()
        val (agent, _) = emittingAgent(start)

        val returned = service(agent, repo, start).generate(acc, tripId, GenerationMode.FULLY_AI)

        returned.generationState shouldBe GenerationState.PARTIAL
        repo.byTrip.getValue(tripId).generationState shouldBe GenerationState.COMPLETE
        agent.captures.size shouldBe 1 // 2차 생성 호출은 없다
    }

    // h09·h10 이 그리는 진행 상태(TRIP-312). 세션이 열리고 닫히지 않으면 화면이 영원히 "생성 중"이다.
    "생성하면 세션이 열리고 day1→DAY1_READY, 2차 완료에 COMPLETED 로 닫힌다" {
        val end = start.plusDays(2)
        val (agent, _) = emittingAgent(end)
        val sessionRepo = FakeGenerationSessions()
        service(agent, FakeItineraries(), end, sessionRepo).generate(acc, tripId, GenerationMode.FULLY_AI)

        val session = sessionRepo.rows.values.single()
        session.status shouldBe GenerationStatus.COMPLETED
        session.day1ReadyAt shouldBe now  // day1 을 지나왔다
        session.finishedAt shouldBe now
    }

    "단일일 여행도 세션이 닫힌다 — 2차가 없다고 진행 중으로 남으면 화면이 계속 폴링한다" {
        val (agent, _) = emittingAgent(start)
        val sessionRepo = FakeGenerationSessions()
        service(agent, FakeItineraries(), start, sessionRepo).generate(acc, tripId, GenerationMode.FULLY_AI)

        sessionRepo.rows.values.single().status shouldBe GenerationStatus.COMPLETED
    }

    // BR-U3-05 — 그만두겠다고 한 뒤 화면이 바뀌면 안 된다. day1 은 이미 봤으므로 그대로 둔다.
    "취소하면 2차 결과를 반영하지 않는다(day1 은 남는다)" {
        val end = start.plusDays(2)
        val poiByDate = generateSequence(start) { it.plusDays(1) }.takeWhile { !it.isAfter(end) }.associateWith { UUID.randomUUID() }
        val sessionRepo = FakeGenerationSessions()
        val agent = object : StubScheduleAgent() {
            var calls = 0
            override fun generate(input: ScheduleAgentInput): ScheduleAgentOutput {
                calls++
                if (calls == 2) {
                    // 2차가 도는 사이 사용자가 [취소]를 눌렀다.
                    sessionRepo.findRunningByTrip(tripId)?.let { sessionRepo.save(it.canceled(now)) }
                }
                return ScheduleAgentOutput(
                    days = input.timeWindows.map { tw ->
                        DaySchedule(tw.date, listOf(VisitSlotDisplay(poiByDate.getValue(tw.date), LocalTime.parse("10:00"), LocalTime.parse("11:00"), false, null, isFixed = false)))
                    },
                    day1ReadyAt = null, explanations = emptyMap(),
                    solveMode = SolveMode.DETERMINISTIC, isFallback = false,
                    freshness = FreshnessMeta(now, degraded = false),
                )
            }
            override fun validate(solution: ScheduleAgentOutput): List<Violation> = emptyList()
            override fun repair(solution: ScheduleAgentOutput, violations: List<Violation>) = RepairResult(solution, emptyList())
            override fun explanations(tripId: UUID, solution: ScheduleAgentOutput): Map<String, String> = emptyMap()
        }
        val repo = FakeItineraries()
        service(agent, repo, end, sessionRepo).generate(acc, tripId, GenerationMode.FULLY_AI)

        val stored = repo.byTrip.getValue(tripId)
        stored.days.map { it.date } shouldContainExactly listOf(start)   // 2차 일자가 붙지 않았다
        stored.generationState shouldBe GenerationState.PARTIAL
        sessionRepo.rows.values.single().status shouldBe GenerationStatus.CANCELED
    }

    /**
     * **근거를 받는 사이에 취소해도 반영하지 않는다**(BR-U3-05 · TRIP-511).
     *
     * 근거 조회는 실측 17.5초다. 취소 확인이 그 **앞**에만 있으면 그 십수 초 동안 [취소]를 누른
     * 사용자도 일정이 완성돼, "그만두겠다고 한 뒤 화면이 바뀐다"가 된다. 확인은 쓰기 직전이어야 한다.
     */
    "근거를 받는 사이에 취소해도 반영하지 않는다" {
        val end = start.plusDays(1)
        val sessionRepo = FakeGenerationSessions()
        val (base, _) = emittingAgent(end)
        val theTrip = tripId // 아래 오버라이드의 파라미터 이름이 바깥 값을 가린다
        val agent = object : ScheduleAgentPort by base {
            override fun explanations(tripId: UUID, solution: ScheduleAgentOutput): Map<String, String> {
                // 근거를 받아 오는 **그 사이에** 사용자가 [취소]를 눌렀다.
                sessionRepo.findRunningByTrip(theTrip)?.let { sessionRepo.save(it.canceled(now)) }
                return emptyMap()
            }
        }
        val repo = FakeItineraries()

        service(agent, repo, end, sessionRepo).generate(acc, tripId, GenerationMode.FULLY_AI)

        val stored = repo.byTrip.getValue(tripId)
        stored.generationState shouldBe GenerationState.PARTIAL       // 마무리가 반영되지 않았다
        stored.days.map { it.date } shouldContainExactly listOf(start) // day1 은 남는다
        sessionRepo.rows.values.single().status shouldBe GenerationStatus.CANCELED
    }

    "그 사이 사용자가 편집·확정했으면 2차 결과를 버린다(덮어쓰기 금지)" {
        val end = start.plusDays(2)
        val (agent, _) = emittingAgent(end)
        val repo = FakeItineraries()
        // 1차 저장 직후 사용자가 편집을 끝낸 상태(COMPLETE)를 시뮬레이션 — 2차는 이 결과를 건드리면 안 된다.
        val edited = Itinerary.create(tripId, SolveMode.DETERMINISTIC, GenerationMode.FULLY_AI, false,
            listOf(ItineraryDay.of(start, 0, emptyList())), now, GenerationState.COMPLETE,
        )
        repo.byTrip[tripId] = edited
        SecondPhaseGenerator(agent, repo, genRevisions(repo, stubTrips), genSessions(), NOOP_TX, clock)
            .completeRemaining(tripId, edited.itineraryId, agentInputFor(end), isRegeneration = false)

        repo.byTrip.getValue(tripId) shouldBe edited // 그대로
    }

    "재생성으로 일정이 교체됐으면 낡은 2차 결과를 버린다" {
        val end = start.plusDays(2)
        val (agent, _) = emittingAgent(end)
        val repo = FakeItineraries()
        val regenerated = Itinerary.create(tripId, SolveMode.DETERMINISTIC, GenerationMode.FULLY_AI, false,
            listOf(ItineraryDay.of(start, 0, emptyList())), now, GenerationState.PARTIAL,
        )
        repo.byTrip[tripId] = regenerated
        // 앞선 1차가 만들었던(이미 교체된) 일정 id 로 도착한 2차
        SecondPhaseGenerator(agent, repo, genRevisions(repo, stubTrips), genSessions(), NOOP_TX, clock)
            .completeRemaining(tripId, UUID.randomUUID(), agentInputFor(end), isRegeneration = false)

        repo.byTrip.getValue(tripId) shouldBe regenerated // 새 일정은 여전히 PARTIAL(제 2차를 기다린다)
    }

    "AI 가 요청하지 않은 일자를 돌려줘도 일자가 중복되지 않는다" {
        val end = start.plusDays(2)
        val poi = UUID.randomUUID()
        // 1차에 day1 만 요청했는데 전 일자를 돌려주는 에이전트(AI 가 아직 일자 분할을 지키지 않는 경우)
        val agent = CapturingAgent(now) { emptyList() }.let {
            object : StubScheduleAgent() {
                val inner = it
                override fun generate(input: ScheduleAgentInput): ScheduleAgentOutput {
                    inner.captures += input
                    val all = generateSequence(start) { d -> d.plusDays(1) }.takeWhile { d -> !d.isAfter(end) }
                    return ScheduleAgentOutput(
                        days = all.map { d ->
                            DaySchedule(d, listOf(VisitSlotDisplay(poi, LocalTime.parse("10:00"), LocalTime.parse("11:00"), false, null, isFixed = false)))
                        }.toList(),
                        day1ReadyAt = null, explanations = emptyMap(),
                        solveMode = SolveMode.DETERMINISTIC, isFallback = false,
                        freshness = FreshnessMeta(now, degraded = false),
                    )
                }
                override fun validate(solution: ScheduleAgentOutput): List<Violation> = emptyList()
                override fun repair(solution: ScheduleAgentOutput, violations: List<Violation>) = RepairResult(solution, emptyList())
                override fun explanations(tripId: UUID, solution: ScheduleAgentOutput): Map<String, String> = emptyMap()
            }
        }
        val repo = FakeItineraries()
        val returned = service(agent, repo, end).generate(acc, tripId, GenerationMode.FULLY_AI)

        returned.days.map { it.date } shouldContainExactly listOf(start) // 1차는 요청한 day1 만 취한다
        val finished = repo.byTrip.getValue(tripId)
        finished.days.map { it.date } shouldContainExactly listOf(start, start.plusDays(1), end) // 중복 없음
        finished.days.map { it.dayOrder } shouldContainExactly listOf(0, 1, 2)
    }

    "AI 가 day1 을 비워 돌려줘도 일자 수는 여행 기간과 같다" {
        val end = start.plusDays(1)
        val agent = CapturingAgent(now) { emptyList() } // 모든 호출이 빈 슬롯
        val repo = FakeItineraries()
        service(agent, repo, end).generate(acc, tripId, GenerationMode.FULLY_AI)

        val finished = repo.byTrip.getValue(tripId)
        finished.days.map { it.date } shouldContainExactly listOf(start, end) // day1 이 사라지지 않는다
    }

    "2차 반영이 터지면 세션도 FAILED 로 닫힌다 — 화면이 실패를 알아야 재생성으로 빠져나간다" {
        val end = start.plusDays(2)
        val (agent, _) = emittingAgent(end)
        // 2차 완료 반영(COMPLETE)만 터진다 — 1차(PARTIAL)는 통과시켜 day1 을 남긴다.
        val repo = object : FakeItineraries() {
            override fun replaceForTrip(tripId: UUID, itinerary: Itinerary): Itinerary {
                if (itinerary.generationState == GenerationState.COMPLETE) throw RuntimeException("db down")
                return super.replaceForTrip(tripId, itinerary)
            }
        }
        val sessionRepo = FakeGenerationSessions()
        service(agent, repo, end, sessionRepo).generate(acc, tripId, GenerationMode.FULLY_AI)

        sessionRepo.rows.values.single().status shouldBe GenerationStatus.FAILED
        repo.byTrip.getValue(tripId).days.map { it.date } shouldContainExactly listOf(start) // day1 은 남는다
    }

    // 500 을 받은 화면이 계속 "생성 중"으로 남으면 사용자는 끝난 적 없는 생성을 기다린다(INV-4 침묵 금지).
    "1차 저장이 터지면 세션을 FAILED 로 닫고 예외를 그대로 올린다" {
        val end = start.plusDays(2)
        val (agent, _) = emittingAgent(end)
        val repo = object : FakeItineraries() {
            override fun replaceForTrip(tripId: UUID, itinerary: Itinerary): Itinerary = throw RuntimeException("db down")
        }
        val sessionRepo = FakeGenerationSessions()

        shouldThrow<RuntimeException> {
            service(agent, repo, end, sessionRepo).generate(acc, tripId, GenerationMode.FULLY_AI)
        }

        sessionRepo.rows.values.single().status shouldBe GenerationStatus.FAILED
    }

    "2차 결과를 반영조차 못하면 FAILED 로 드러낸다(1차분은 유효)" {
        val end = start.plusDays(2)
        val (agent, _) = emittingAgent(end)
        val partial = Itinerary.create(tripId, SolveMode.FULL_AI, GenerationMode.FULLY_AI, false,
            listOf(ItineraryDay.of(start, 0, emptyList())), now, GenerationState.PARTIAL,
        )
        // 완료 반영(replaceForTrip)만 터지고 FAILED 표시는 통과하는 저장소 — 상태 전이 경로를 갈라 본다.
        val repo = object : FakeItineraries() {
            override fun replaceForTrip(tripId: UUID, itinerary: Itinerary): Itinerary {
                if (itinerary.generationState == GenerationState.COMPLETE) throw RuntimeException("db down")
                return super.replaceForTrip(tripId, itinerary)
            }
        }
        repo.byTrip[tripId] = partial
        SecondPhaseGenerator(agent, repo, genRevisions(repo, stubTrips), genSessions(), NOOP_TX, clock).completeRemaining(tripId, partial.itineraryId, agentInputFor(end), isRegeneration = false)

        val finished = repo.byTrip.getValue(tripId)
        finished.generationState shouldBe GenerationState.FAILED
        finished.days.map { it.date } shouldContainExactly listOf(start) // 1차분 보존
    }

    "2차 실패: 결정론 최소 폴백으로 나머지를 채우고 저하를 표시(INV-4 — 1차와 대칭)" {
        val end = start.plusDays(2)
        val poi1 = UUID.randomUUID()
        // 1차만 성공하고 2차 호출에서 터지는 에이전트
        val agent = object : StubScheduleAgent() {
            var calls = 0
            override fun generate(input: ScheduleAgentInput): ScheduleAgentOutput {
                if (calls++ > 0) throw RuntimeException("agent down")
                return ScheduleAgentOutput(
                    days = input.timeWindows.map {
                        DaySchedule(it.date, listOf(VisitSlotDisplay(poi1, LocalTime.parse("10:00"), LocalTime.parse("11:00"), false, null, isFixed = false)))
                    },
                    day1ReadyAt = null, explanations = emptyMap(),
                    solveMode = SolveMode.DETERMINISTIC, isFallback = false,
                    freshness = FreshnessMeta(now, degraded = false),
                )
            }
            override fun validate(solution: ScheduleAgentOutput): List<Violation> = emptyList()
            override fun repair(solution: ScheduleAgentOutput, violations: List<Violation>) = RepairResult(solution, emptyList())
            override fun explanations(tripId: UUID, solution: ScheduleAgentOutput): Map<String, String> = emptyMap()
        }
        val repo = FakeItineraries()
        service(agent, repo, end).generate(acc, tripId, GenerationMode.FULLY_AI)

        val finished = repo.byTrip.getValue(tripId)
        finished.generationState shouldBe GenerationState.COMPLETE   // 실패를 이유로 나머지를 비워두지 않는다
        finished.days.map { it.date } shouldContainExactly listOf(start, start.plusDays(1), end)
        finished.days.first().slots.single().sourcePoiId shouldBe poi1 // day1(1차 결과)은 그대로 보존
        finished.days.drop(1).all { it.slots.isEmpty() } shouldBe true // 폴백엔 고정 블록만(여기선 없음)
        // 품질 저하는 감추지 않는다 — 두 호출 중 낮은 등급으로 기록
        finished.solveMode shouldBe SolveMode.MINIMAL
        finished.isFallback shouldBe true
    }
})

/** 2단계 분할이 여행 길이와 무관하게 일자를 정확히 한 번씩 덮는지 — 길이별 경계(1일·2일·N일)를 성질로 고정. */
class TwoPhaseDayCoverageTest : StringSpec({

    val now = Instant.parse("2026-07-25T00:00:00Z")
    val clock = Clock.fixed(now, ZoneOffset.UTC)
    val acc = UUID.randomUUID()
    val start = LocalDate.parse("2026-08-01")
    val prefs = PreferenceSnapshot(emptyList(), emptyList(), emptyList(), emptyList(), null, emptyList(), false, null)

    "여행 길이 N(1~10)에서 두 호출이 전 일자를 정확히 한 번씩 덮고 dayOrder 는 0..N-1" {
        checkAll(Arb.int(1..10)) { nights ->
            val tripId = UUID.randomUUID()
            val end = start.plusDays((nights - 1).toLong())
            val expected = generateSequence(start) { it.plusDays(1) }.takeWhile { !it.isAfter(end) }.toList()

            val agent = CapturingAgent(now) { date ->
                listOf(VisitSlotDisplay(UUID.randomUUID(), LocalTime.parse("10:00"), LocalTime.parse("11:00"), false, null, isFixed = false))
                    .also { require(date in expected) }
            }
            val repo = FakeItineraries()
            val trips = object : TripFacade {
                override fun findPeriod(accountId: UUID, tripId: UUID) = TripPeriod(start, end)
                override fun findGenerationContext(accountId: UUID, tripId: UUID) =
                    TripGenerationContext(start, end, listOf("제주"), "친구", 500_000, emptyList())
            }
            val preferences = object : PreferenceFacade {
                override fun findPreferences(accountId: UUID) = prefs
            }
            val baseAnchors = object : BaseAnchorFacade {
                override fun findStayNightAnchors(tripId: UUID, startDate: LocalDate, endDate: LocalDate) = emptyList<DayAnchorView>()
            }
            val second = SecondPhaseGenerator(agent, repo, genRevisions(repo, trips), genSessions(), NOOP_TX, clock)
            GenerateItineraryService(trips, preferences, baseAnchors, agent, repo, CapturingPublisher(), second, genSessions(), genRevisions(repo, trips), StubRegions, NOOP_TX, clock, defaultDeadlines)
                .generate(acc, tripId, GenerationMode.FULLY_AI)

            // 두 호출이 요청한 일자의 합 = 여행 일자, 중복 없음
            agent.captures.flatMap { c -> c.timeWindows.map { it.date } } shouldContainExactly expected
            val finished = repo.byTrip.getValue(tripId)
            finished.days.map { it.date } shouldContainExactly expected
            finished.days.map { it.dayOrder } shouldContainExactly expected.indices.toList()
            finished.generationState shouldBe GenerationState.COMPLETE
            agent.captures.size shouldBe if (nights == 1) 1 else 2
        }
    }
})

/**
 * 지역 대표 좌표 대역 — 숙소 없는 날의 앵커(TRIP-384).
 *
 * 좌표를 **주는 경우와 안 주는 경우**가 둘 다 필요하다. 주면 앵커가 채워지고, 없으면 예전처럼 빈다.
 */
private object StubRegions : com.trippilot.placedata.api.RegionLookupFacade {
    override fun codesOf(regionName: String): List<String> = emptyList()
    override fun centerOf(regionName: String) =
        if (regionName == "좌표없는곳") null else com.trippilot.placedata.api.RegionCenter(33.4996, 126.5312)
}
