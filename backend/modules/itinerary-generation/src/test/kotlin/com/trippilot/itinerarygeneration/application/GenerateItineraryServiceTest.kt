package com.trippilot.itinerarygeneration.application

import com.trippilot.itinerarygeneration.domain.PersonalizationHints
import com.trippilot.itinerarygeneration.domain.PersonalizationPort
import com.trippilot.itinerarygeneration.domain.VisitRecordPort
import com.trippilot.itinerarygeneration.domain.DayAnchor
import com.trippilot.itinerarygeneration.domain.DaySchedule
import com.trippilot.itinerarygeneration.domain.FreshnessMeta
import com.trippilot.itinerarygeneration.domain.GenerationState
import com.trippilot.itinerarygeneration.domain.GenerationMode
import com.trippilot.itinerarygeneration.domain.GenerationStatus
import com.trippilot.itinerarygeneration.domain.Itinerary
import com.trippilot.itinerarygeneration.domain.NewRevision
import com.trippilot.itinerarygeneration.domain.ItineraryRevisionRepository
import com.trippilot.itinerarygeneration.domain.RevisionKind
import com.trippilot.itinerarygeneration.domain.ItineraryRevision
import com.trippilot.itinerarygeneration.domain.ItineraryRevisionSummary
import com.trippilot.itinerarygeneration.domain.ItineraryRepository
import com.trippilot.itinerarygeneration.domain.RepairResult
import com.trippilot.itinerarygeneration.domain.FixedBlock
import com.trippilot.itinerarygeneration.domain.ScheduleAgentCallFailed
import com.trippilot.itinerarygeneration.domain.UnplacedMustVisit
import com.trippilot.itinerarygeneration.domain.UnplacedReason
import com.trippilot.itinerarygeneration.domain.ScheduleAgentInput
import com.trippilot.itinerarygeneration.domain.ScheduleAgentOutput
import com.trippilot.itinerarygeneration.domain.RejectedPoi
import com.trippilot.itinerarygeneration.domain.VisitSlot
import com.trippilot.itinerarygeneration.domain.RejectionStore
import com.trippilot.itinerarygeneration.domain.ScoredCandidate
import com.trippilot.itinerarygeneration.domain.ScoredCandidatePool
import com.trippilot.itinerarygeneration.domain.ScoredCandidatePoolStore
import com.trippilot.itinerarygeneration.domain.SlotExplanations
import io.kotest.assertions.withClue
import com.trippilot.itinerarygeneration.domain.SlotAlternative
import com.trippilot.itinerarygeneration.domain.ScheduleAgentPort
import com.trippilot.itinerarygeneration.domain.SolveMode
import com.trippilot.itinerarygeneration.domain.ItineraryDay
import com.trippilot.itinerarygeneration.domain.PreferenceProfile
import com.trippilot.itinerarygeneration.domain.RequestMeta
import com.trippilot.itinerarygeneration.domain.ScoringMode
import com.trippilot.itinerarygeneration.domain.ScoringSignal
import com.trippilot.itinerarygeneration.domain.TimeWindow
import com.trippilot.itinerarygeneration.domain.TodayWindow
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
import com.trippilot.trip.api.TripDestinationRef
import com.trippilot.trip.api.TripGenerationContext
import com.trippilot.trip.api.TripPeriod
import com.trippilot.core.error.ValidationFailed
import io.kotest.assertions.throwables.shouldThrow
import io.kotest.core.spec.style.StringSpec
import io.kotest.property.Arb
import io.kotest.property.arbitrary.int
import io.kotest.property.arbitrary.list
import io.kotest.property.checkAll
import com.trippilot.core.error.ConflictDetected
import com.trippilot.core.error.ErrorCode
import com.trippilot.itinerarygeneration.domain.GenerationSession
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
 * **구형 AI(TRIP-1249 이전 계약)** 의 거부를 흉내낸다 — `start` 가 null 인 고정 블록이 **하나라도** 있으면 요청 전체를
 * 거부한다(그쪽 `FixedBlockSchema.start` 가 필수라 422). 배포 순서가 역전되면(BE 먼저) 실제로 이 모양이 된다.
 * 그 외 요청은 정상 응답.
 */
private class RejectAnytimeAgent(private val now: Instant, private val emitPoi: UUID) : StubScheduleAgent() {
    override fun generate(input: ScheduleAgentInput): ScheduleAgentOutput {
        if (input.fixedBlocks.any { it.start == null }) {
            throw ScheduleAgentCallFailed("VALIDATION_ERROR", retryable = false, message = "start 필수 — 구형 계약의 422")
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
    override fun explanations(tripId: UUID, solution: ScheduleAgentOutput, preference: PreferenceProfile?, companionType: String?): SlotExplanations = SlotExplanations()
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
    override fun explanations(tripId: UUID, solution: ScheduleAgentOutput, preference: PreferenceProfile?, companionType: String?): SlotExplanations = SlotExplanations()
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
    override fun explanations(tripId: UUID, solution: ScheduleAgentOutput, preference: PreferenceProfile?, companionType: String?): SlotExplanations = SlotExplanations()
}

private class CapturingAgent(
    private val now: Instant,
    /** 점수 후보 풀(TRIP-969) — 호출별로 다른 풀을 줄 수 있다(1차·2차). 기본 null = 옛 응답.
     * `emit` 앞에 있는 이유: 트레일링 람다로 `emit` 을 넘기는 기존 호출들이 그대로 살게. */
    private val scored: (ScheduleAgentInput) -> ScoredCandidatePool? = { null },
    private val emit: (LocalDate) -> List<VisitSlotDisplay> = { emptyList() },
) : StubScheduleAgent() {
    val captures = mutableListOf<ScheduleAgentInput>()
    val captured: ScheduleAgentInput? get() = captures.firstOrNull()
    override fun generate(input: ScheduleAgentInput): ScheduleAgentOutput {
        captures += input
        return ScheduleAgentOutput(
            days = input.timeWindows.map { DaySchedule(it.date, emit(it.date)) },
            day1ReadyAt = null, explanations = emptyMap(),
            solveMode = SolveMode.DETERMINISTIC, isFallback = false,
            freshness = FreshnessMeta(now, degraded = false),
            scoredCandidates = scored(input),
        )
    }
    override fun validate(solution: ScheduleAgentOutput): List<Violation> = emptyList()
    override fun repair(solution: ScheduleAgentOutput, violations: List<Violation>) = RepairResult(solution, emptyList())
    /** 근거 조회에 실린 취향·동행 — 생성과 같은 취향이어야 한다(BR-U1-38). */
    val explainedWith = mutableListOf<Pair<PreferenceProfile?, String?>>()
    override fun explanations(
        tripId: UUID, solution: ScheduleAgentOutput, preference: PreferenceProfile?, companionType: String?,
    ): SlotExplanations {
        explainedWith += preference to companionType
        return SlotExplanations()
    }
}

/** 호출마다 정해 둔 점수 신호를 돌려주는 대역(TRIP-1173). null 이면 그 호출은 실패한다(→ 최소 폴백). */
private class ScoringAgent(private val now: Instant, private val perCall: List<ScoringSignal?>) : StubScheduleAgent() {
    private var calls = 0
    override fun generate(input: ScheduleAgentInput): ScheduleAgentOutput {
        val signal = perCall[calls++] ?: throw ScheduleAgentCallFailed("AI_ERROR", retryable = false, message = "점수 단계 이후 실패 재현")
        return ScheduleAgentOutput(
            days = input.timeWindows.map { DaySchedule(it.date, emptyList()) },
            day1ReadyAt = null, explanations = emptyMap(),
            solveMode = SolveMode.FULL_AI, isFallback = false,
            freshness = FreshnessMeta(now, degraded = false),
            scoring = signal,
        )
    }
    override fun validate(solution: ScheduleAgentOutput): List<Violation> = emptyList()
    override fun repair(solution: ScheduleAgentOutput, violations: List<Violation>) = RepairResult(solution, emptyList())
    override fun explanations(tripId: UUID, solution: ScheduleAgentOutput, preference: PreferenceProfile?, companionType: String?) = SlotExplanations()
}

/** ScheduleAgent(AI) 실패 재현 — INV-4 폴백 경로 검증용. */
private class ThrowingAgent : StubScheduleAgent() {
    override fun generate(input: ScheduleAgentInput): ScheduleAgentOutput = throw RuntimeException("agent down")
    override fun validate(solution: ScheduleAgentOutput): List<Violation> = emptyList()
    override fun repair(solution: ScheduleAgentOutput, violations: List<Violation>) = RepairResult(solution, emptyList())
    override fun explanations(tripId: UUID, solution: ScheduleAgentOutput, preference: PreferenceProfile?, companionType: String?): SlotExplanations = SlotExplanations()
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

internal fun genRevisions(
    repo: ItineraryRepository,
    trips: TripFacade,
    clock: Clock = Clock.fixed(Instant.parse("2026-07-25T00:00:00Z"), ZoneOffset.UTC),
    log: ItineraryRevisionRepository = GenFakeRevisions(),
) = ItineraryRevisionService(log, repo, trips, NoopValidateAgent(), NOOP_TX, clock)

/** 리비전 기록을 관찰하는 인메모리 저장소 — seq 는 순서대로 부여. */
internal class GenFakeRevisions : ItineraryRevisionRepository {
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
        destinations: List<TripDestinationRef> = refs("제주"),
        clock: Clock = Clock.fixed(now, ZoneOffset.UTC),
        rejectionStore: RejectionStore = FakeRejectionStore(),
        // 기본값 인자는 **맨 뒤에** 둔다 — 중간에 끼우면 위치 인자로 부르는 호출이 조용히 어긋난다.
        personalization: PersonalizationPort = NoPersonalization,
        scoredPools: ScoredCandidatePoolStore = FakeScoredCandidatePoolStore(),
        tripSnapshot: Map<String, Any?> = emptyMap(),
        accountPrefs: () -> PreferenceSnapshot = { prefs },
        dayStartAt: LocalTime? = null,
        firstDayStartAt: LocalTime? = null,
        lastDayEndAt: LocalTime? = null,
        visits: VisitRecordPort = NoVisits,
        revisionLog: ItineraryRevisionRepository = GenFakeRevisions(),
    ): GenerateItineraryService {
        val trips = object : TripFacade {
            override fun findPeriod(accountId: UUID, tripId: UUID) = TripPeriod(start, end)
            @Suppress("UNUSED_PARAMETER")
            override fun findGenerationContext(accountId: UUID, tripId: UUID) =
                if (accountId == acc) {
                    TripGenerationContext(
                        start, end, destinations, "친구", 500_000, fixedVisits, tripSnapshot,
                        dayStartAt, firstDayStartAt, lastDayEndAt,
                    )
                } else {
                    null
                }
        }
        val preferences = object : PreferenceFacade {
            override fun findPreferences(accountId: UUID) = accountPrefs()
        }
        val baseAnchors = object : BaseAnchorFacade {
            override fun findStayNightAnchors(tripId: UUID, startDate: LocalDate, endDate: LocalDate) = anchors
        }
        // 단위 테스트엔 Spring 프록시가 없어 @Async 가 걸리지 않는다 → 2차가 그 자리에서 동기 실행된다(결정론).
        // 1차·2차가 **같은 세션**을 봐야 취소가 2차에 전달된다 — 인스턴스를 나누면 취소가 사라진다.
        val sessions = genSessions(trips, sessionRepo, clock, defaultDeadlines)
        val second = SecondPhaseGenerator(agent, repo, genRevisions(repo, trips), sessions, scoredPools, NOOP_TX, clock)
        return GenerateItineraryService(trips, preferences, baseAnchors, agent, repo, publisher, second, sessions, genRevisions(repo, trips, log = revisionLog), StubRegions, rejectionStore, scoredPools, personalization, visits, NOOP_TX, clock, defaultDeadlines)
    }

    val fullPrefs = PreferenceSnapshot(
        styles = listOf("미식"), activities = listOf("야경"), foodTastes = listOf("한식"),
        transportModes = listOf("렌터카"), pace = "알차게", companionTypes = listOf("친구"),
        petFriendly = true, budgetTier = "고급",
    )

    // ── 기록 기반 개인화 병합(TRIP-556 · BR-U5-44) ────────────────────
    "동의가 없으면 추천 입력에 과거 기록이 한 건도 없다" {
        val agent = CapturingAgent(now)

        service(agent, fullPrefs, emptyList()).generate(acc, tripId, GenerationMode.FULLY_AI)

        // 게이트는 개인화 쪽이 소유하고, 여기 오는 힌트는 비어 있다 — 그러면 보탤 것이 없다.
        agent.captures.forEach {
            it.preferenceProfile.activities shouldBe listOf("야경")
            it.preferenceProfile.pace shouldBe "알차게"
        }
    }

    "개인화는 보태기만 한다 — 사용자가 고른 값을 덮지 않는다" {
        val agent = CapturingAgent(now)
        val hinted = object : PersonalizationPort {
            override fun hintsFor(accountId: UUID) = PersonalizationHints(listOf("카페", "자연"), "느긋하게")
        }

        service(agent, fullPrefs, emptyList(), personalization = hinted).generate(acc, tripId, GenerationMode.FULLY_AI)

        val profile = agent.captured!!.preferenceProfile
        // 합집합이고 사용자가 고른 것이 앞이다.
        profile.activities shouldContainExactly listOf("야경", "카페", "자연")
        // 스칼라라 합칠 수 없다 → **명시 선택이 이긴다.** 과거 행동이 고른 값을 뒤집으면
        // "왜 내가 고른 게 무시되지"가 된다.
        profile.pace shouldBe "알차게"
    }

    "고르지 않은 축은 개인화가 채운다" {
        val agent = CapturingAgent(now)
        val bare = fullPrefs.copy(activities = emptyList(), pace = null)
        val hinted = object : PersonalizationPort {
            override fun hintsFor(accountId: UUID) = PersonalizationHints(listOf("카페"), "느긋하게")
        }

        service(agent, bare, emptyList(), personalization = hinted).generate(acc, tripId, GenerationMode.FULLY_AI)

        val profile = agent.captured!!.preferenceProfile
        profile.activities shouldContainExactly listOf("카페")
        profile.pace shouldBe "느긋하게"
    }

    "1차와 2차가 같은 개인화 값을 쓴다 — 한 여행이 두 규칙으로 만들어지지 않는다" {
        val agent = CapturingAgent(now)
        var asked = 0
        val counting = object : PersonalizationPort {
            override fun hintsFor(accountId: UUID): PersonalizationHints {
                asked++
                return PersonalizationHints(listOf("카페"), null)
            }
        }

        service(agent, fullPrefs, emptyList(), personalization = counting).generate(acc, tripId, GenerationMode.FULLY_AI)

        asked shouldBe 1
        agent.captures.size shouldBe 2
        agent.captures.forEach { it.preferenceProfile.activities shouldContainExactly listOf("야경", "카페") }
    }

    // ── 여행에서 고른 취향이 최종(BR-U1-38) ────────────────────────────
    "여행 생성 때 고른 취향이 계정 취향을 이긴다 — 1차·2차 모두" {
        val agent = CapturingAgent(now)
        val account = fullPrefs.copy(styles = listOf("액티비티"))

        service(agent, account, emptyList(), tripSnapshot = mapOf("styles" to listOf("미식"), "activities" to emptyList<String>()))
            .generate(acc, tripId, GenerationMode.FULLY_AI)

        agent.captures.size shouldBe 2
        // 뒤따라 받는 근거도 같은 취향·이 여행의 동행으로 쓰인다.
        agent.explainedWith.single().first!!.styles shouldContainExactly listOf("미식")
        agent.explainedWith.single().second shouldBe "친구"
        agent.captures.forEach {
            it.preferenceProfile.styles shouldContainExactly listOf("미식")
            // 비운 축도 선택이다 — 계정 값(야경)으로 되살리지 않는다.
            it.preferenceProfile.activities shouldBe emptyList()
            // 여행이 안 정한 축은 계정 값.
            it.preferenceProfile.transportModes shouldContainExactly listOf("렌터카")
            it.tripContext.budgetLevel shouldBe "고급"
        }
    }

    "하루 여행도 근거를 여행 취향으로 받는다 — 2차 입력이 없는 갈래" {
        val agent = CapturingAgent(now)

        service(agent, fullPrefs.copy(styles = listOf("액티비티")), emptyList(), end = start,
            tripSnapshot = mapOf("styles" to listOf("미식")))
            .generate(acc, tripId, GenerationMode.FULLY_AI)

        agent.captures.size shouldBe 1
        agent.explainedWith.single().first!!.styles shouldContainExactly listOf("미식")
    }

    "스냅숏이 비었으면({}) 계정 취향 — 구버전 여행" {
        val agent = CapturingAgent(now)

        service(agent, fullPrefs, emptyList(), tripSnapshot = emptyMap()).generate(acc, tripId, GenerationMode.FULLY_AI)

        agent.captured!!.preferenceProfile.styles shouldContainExactly listOf("미식")
        agent.captured!!.preferenceProfile.activities shouldContainExactly listOf("야경")
    }

    "계정 취향을 바꾼 뒤 재생성해도 여행에서 고른 취향은 그대로다" {
        val agent = CapturingAgent(now)
        var account = fullPrefs.copy(styles = listOf("액티비티"))
        val svc = service(
            agent, account, emptyList(),
            tripSnapshot = mapOf("styles" to listOf("미식")),
            accountPrefs = { account },
        )
        svc.generate(acc, tripId, GenerationMode.FULLY_AI)

        account = account.copy(styles = listOf("힐링"), transportModes = listOf("대중교통"))
        agent.captures.clear()
        svc.generate(acc, tripId, GenerationMode.FULLY_AI)

        agent.captures.forEach {
            it.preferenceProfile.styles shouldContainExactly listOf("미식")
            it.preferenceProfile.transportModes shouldContainExactly listOf("대중교통") // 여행이 안 정한 축은 계정 현재값
        }
    }

    // TRIP-1412 4차 검수 — 생성의 쓰기 트랜잭션도 일정 쓰기 잠금을 잡는다. 안 잡으면 되돌리기·편집이 읽고 교체(trip_id 로 지우기)하는
    // 사이에 끼어들어 한쪽이 조용히 사라진다. 잠금은 **AI 를 다 부른 뒤**, 1차·2차 쓰기 바로 앞에서만 잡힌다.
    "생성 1차·2차 쓰기는 일정 쓰기 잠금을 잡은 뒤에만 쓴다 — AI 호출 중에는 잡지 않는다" {
        val events = mutableListOf<String>()
        val agent = object : ScheduleAgentPort by CapturingAgent(now) {
            override fun generate(input: ScheduleAgentInput) = CapturingAgent(now).generate(input).also { events += "ai" }
        }
        val repo = object : FakeItineraries() {
            // 대역의 조건부 쓰기는 안에서 replaceForTrip 을 부른다 — 쓰기는 거기서 한 번만 센다.
            override fun replaceForTrip(tripId: UUID, itinerary: Itinerary) = super.replaceForTrip(tripId, itinerary).also { events += "write" }
            override fun lockForTrip(tripId: UUID) = findByTrip(tripId).firstOrNull().also { events += "lock" }
        }

        service(agent, fullPrefs, emptyList(), repo = repo).generate(acc, tripId, GenerationMode.FULLY_AI)

        // 1차: AI → 잠금 → 쓰기 / 2차: AI → 잠금 → 조건부 쓰기(재생성 방어). 쓰기마다 바로 앞에 잠금이 있다.
        events.windowed(2).filter { it[1] == "write" }.forEach { it[0] shouldBe "lock" }
        events.count { it == "write" } shouldBe 2
        events.first() shouldBe "ai"
    }

    // 5차 검수 — 리비전 종류(처음 vs 다시)도 잠금 뒤 값으로 정한다. 잠금 전엔 없던 일정이 잠금 뒤 보이면 "다시 만들기"다.
    "직접 만들기의 리비전 종류는 잠금 뒤 일정으로 정한다" {
        val existing = Itinerary.create(tripId, SolveMode.DETERMINISTIC, GenerationMode.FULLY_AI, false,
            listOf(ItineraryDay.of(start, 0, emptyList())), now, GenerationState.COMPLETE,
        )
        val repo = object : FakeItineraries() {
            override fun findByTrip(tripId: UUID): List<Itinerary> = emptyList() // 잠금 전 읽기엔 없었다
            override fun lockForTrip(tripId: UUID) = existing
        }
        val log = GenFakeRevisions()

        service(CapturingAgent(now), fullPrefs, emptyList(), repo = repo, revisionLog = log).generate(acc, tripId, GenerationMode.MANUAL)

        log.appended.last().kind shouldBe RevisionKind.GENERATE
        log.appended.first().kind shouldBe RevisionKind.BASELINE // 잠금 뒤 현행이 되돌리기 지점으로 남았다
    }

    "직접 만들기도 일정 쓰기 잠금을 잡은 뒤에 쓴다" {
        val events = mutableListOf<String>()
        val repo = object : FakeItineraries() {
            override fun replaceForTrip(tripId: UUID, itinerary: Itinerary) = super.replaceForTrip(tripId, itinerary).also { events += "write" }
            override fun lockForTrip(tripId: UUID) = findByTrip(tripId).firstOrNull().also { events += "lock" }
        }

        service(CapturingAgent(now), fullPrefs, emptyList(), repo = repo).generate(acc, tripId, GenerationMode.MANUAL)

        events shouldContainExactly listOf("lock", "write")
    }

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

    // ── 여행이 정한 일과 창(실사용 피드백 2026-10-07 "일정을 무조건 9시부터 짜준다") ──────
    // 필수 방문지를 **비운다** — 고정 블록이 있으면 창이 그쪽으로 넓어져(expandedWindow) 기본 창이
    // 무엇이었는지 가려진다. 여기서 재는 것은 "사용자가 적은 값이 그 날의 기본 창이 되는가"다.

    "하루 시작 시각을 적으면 전 일자가 그 시각에 시작한다 — 상수 09:00 이 아니라" {
        val agent = CapturingAgent(now)

        service(agent, fullPrefs, emptyList(), fixedVisits = emptyList(), dayStartAt = LocalTime.parse("11:00"))
            .generate(acc, tripId, GenerationMode.FULLY_AI)

        agent.captures.flatMap { it.timeWindows }.forEach { it.start shouldBe LocalTime.parse("11:00") }
    }

    "첫날 시작 시각은 그 날에만 걸린다 — 도착 전 시간에 일정이 깔리던 것" {
        val agent = CapturingAgent(now)

        service(
            agent, fullPrefs, emptyList(), fixedVisits = emptyList(),
            dayStartAt = LocalTime.parse("10:00"), firstDayStartAt = LocalTime.parse("14:00"),
        ).generate(acc, tripId, GenerationMode.FULLY_AI)

        val windows = agent.captures.flatMap { it.timeWindows }
        windows.first { it.date == start }.start shouldBe LocalTime.parse("14:00")
        // 첫날 값이 나머지 날로 새면 안 된다 — 그러면 "도착이 늦었으니 여행 내내 늦게 시작"이 된다.
        windows.filter { it.date != start }.forEach { it.start shouldBe LocalTime.parse("10:00") }
    }

    "아무것도 안 적으면 종전 그대로다 — 기존 여행의 일정이 달라지지 않는다" {
        val agent = CapturingAgent(now)

        service(agent, fullPrefs, emptyList(), fixedVisits = emptyList())
            .generate(acc, tripId, GenerationMode.FULLY_AI)

        agent.captures.flatMap { it.timeWindows }.forEach {
            it.start shouldBe LocalTime.parse("09:00")
            it.end shouldBe LocalTime.parse("21:00")
        }
    }

    "마지막날 종료 시각은 그 날에만 걸린다 — 2차의 다른 날까지 좁히지 않는다" {
        // 적대적 리뷰가 잡은 자리: 창을 min/max 로 접으면 마지막날 10시 귀가가 2차 전 일자에 걸려
        // 비어 있는 날에도 "넣을 자리가 없습니다"가 나간다. ANYTIME 은 일자 많은 쪽(2차)이 맡으므로
        // 필수 방문지를 날짜 미지정으로 두어 그 경로를 실제로 지난다.
        val agent = CapturingAgent(now)
        val anytime = UUID.randomUUID()

        service(
            agent, fullPrefs, emptyList(),
            fixedVisits = listOf(FixedVisit(anytime, null, null, 120)),
            lastDayEndAt = LocalTime.parse("10:00"),
        ).generate(acc, tripId, GenerationMode.FULLY_AI)

        val windows = agent.captures.flatMap { it.timeWindows }
        windows.first { it.date == defaultEnd }.end shouldBe LocalTime.parse("10:00")
        windows.filter { it.date != defaultEnd }.forEach { it.end shouldBe LocalTime.parse("21:00") }
        // 2시간짜리 ANYTIME 은 09:00~21:00 인 날에 들어간다 — 마지막날 창에 막혀 미배치가 되면 안 된다.
        (anytime in agent.captures.flatMap { it.fixedBlocks }.map { it.poiId }) shouldBe true
    }

    "뒤집힌 창은 **아무것도 쓰기 전에** 막는다 — 2차에서 터지면 생성 중에 고착된다" {
        // 다일 여행 + lastDayEndAt 뒤집힘. 종전 구현은 1차를 커밋하고 세션을 day1Ready 로 연 뒤
        // 2차 조립(try 밖)에서 던져, 400 을 받고도 화면이 영원히 폴링했다(복구 경로 없음).
        val agent = CapturingAgent(now)

        shouldThrow<ValidationFailed> {
            service(agent, fullPrefs, emptyList(), fixedVisits = emptyList(), lastDayEndAt = LocalTime.parse("08:00"))
                .generate(acc, tripId, GenerationMode.FULLY_AI)
        }
        // 경계를 **한 번도 안 불렀다** = 쓰기 전에 막혔다.
        agent.captures.size shouldBe 0
    }

    "창이 뒤집히는 값은 막는다 — 조용히 '해 없음'이 되지 않게" {
        val agent = CapturingAgent(now)

        shouldThrow<ValidationFailed> {
            service(agent, fullPrefs, emptyList(), fixedVisits = emptyList(), dayStartAt = LocalTime.parse("23:00"))
                .generate(acc, tripId, GenerationMode.FULLY_AI)
        }
    }

    "창 밖 고정 블록이 있는 날만 일과 창이 넓어진다 — 21:00+60분이면 그 날 끝이 22:00 (TRIP-1001 결정 (c))" {
        // 안 넓히면 이 블록 하나가 HC4 를 깨 그 날 전체가 "해 없음" → 409 → 최소 폴백이다(QA #045).
        val late = UUID.randomUUID()
        val day2 = start.plusDays(1)
        val agent = CapturingAgent(now)
        service(agent, fullPrefs, emptyList(), fixedVisits = listOf(FixedVisit(late, day2, LocalTime.parse("21:00"), 60)))
            .generate(acc, tripId, GenerationMode.FULLY_AI)

        val second = agent.captures[1]
        second.timeWindows.first { it.date == day2 }.end shouldBe LocalTime.parse("22:00")
        second.timeWindows.first { it.date == day2 }.start shouldBe LocalTime.parse("09:00") // 시작은 그대로
        second.timeWindows.first { it.date != day2 }.end shouldBe LocalTime.parse("21:00") // 다른 날은 기본 창
    }

    "이른 고정 블록이면 창 시작이 앞으로 넓어진다" {
        val early = UUID.randomUUID()
        val agent = CapturingAgent(now)
        service(agent, fullPrefs, emptyList(), fixedVisits = listOf(FixedVisit(early, start, LocalTime.parse("07:30"), 60)))
            .generate(acc, tripId, GenerationMode.FULLY_AI)

        agent.captures[0].timeWindows.first { it.date == start }.start shouldBe LocalTime.parse("07:30")
    }

    "고정 블록이 자정을 넘으면 창 끝은 23:59 에 멈춘다 — end < start 인 모순 창을 만들지 않는다" {
        val midnight = UUID.randomUUID()
        val agent = CapturingAgent(now)
        service(agent, fullPrefs, emptyList(), fixedVisits = listOf(FixedVisit(midnight, start, LocalTime.parse("23:30"), 60)))
            .generate(acc, tripId, GenerationMode.FULLY_AI)

        agent.captures[0].timeWindows.first { it.date == start }.end shouldBe LocalTime.parse("23:59")
    }

    // 출발일 당일에 만들면 오늘은 **지금부터** 연다. 종전엔 저녁에 만들어도 오늘이 09:00 부터 깔려
    // 이미 지난 시각의 장소가 정상 일정처럼 보였다. 시각은 KST(09:10Z = 18:10).

    "출발일 저녁에 만들면 오늘은 지금부터 연다 — 이미 지난 시각에 장소를 놓지 않는다" {
        val agent = CapturingAgent(now)
        service(agent, fullPrefs, emptyList(), fixedVisits = emptyList(), clock = Clock.fixed(Instant.parse("2026-08-01T09:10:00Z"), ZoneOffset.UTC))
            .generate(acc, tripId, GenerationMode.FULLY_AI)

        // 18:10 + 이동 여유 30분 = 18:40 → 30분 단위로 올려 19:00. 끝은 지금부터 4시간(23:00) — 하루 끝 21:00 보다 늦다.
        agent.captures[0].timeWindows shouldContainExactly listOf(TimeWindow(start, LocalTime.parse("19:00"), LocalTime.parse("23:00")))
        agent.captures[1].timeWindows.forEach { it.start shouldBe LocalTime.parse("09:00") } // 내일부터는 종전 그대로
    }

    // 기본 하루 끝(21:00)이 저녁 생성을 막았다 — 20:04 에 만들면 지금+30분이 21:00 이라 오늘이 닫혀,
    // 당일치기는 AI 를 한 번도 안 부르고 빈 일정이 나갔다(DEV 10-14 팀원 실측, 생성 0.05초 · 연타).
    // 오늘은 지금부터 **4시간**을 보장하되 하루 끝(23:59)을 넘기지 않는다(2026-10-20 사용자, 종전 2시간) — 저녁·카페·야경.
    // 사용자가 적은 끝은 늘리지 않는다.

    "출발일 저녁 8시에 만들어도 오늘은 21:00~23:59 로 연다 — 저녁에도 들어갈 만큼 넣는다" {
        val agent = CapturingAgent(now)
        service(agent, fullPrefs, emptyList(), fixedVisits = emptyList(), clock = Clock.fixed(Instant.parse("2026-08-01T11:04:00Z"), ZoneOffset.UTC))
            .generate(acc, tripId, GenerationMode.FULLY_AI)

        agent.captures[0].timeWindows shouldContainExactly listOf(TimeWindow(start, LocalTime.parse("21:00"), LocalTime.parse("23:59")))
    }

    // 밤 10시 무렵부터는 지금부터 2시간이 23:59 를 넘는다 — 익일 01:00 까지 연다(2026-10-20 사용자). 끝 < 시작인
    // 새벽 끝은 다음 날이다(AI 경계 규칙). 그 시간대 무엇을 넣을지는 AI 가 취향으로 고른다.
    "밤 9시 반에 만들면 오늘은 22:00~익일 01:00 으로 연다 — 야경·늦게 여는 곳 한두 곳" {
        val agent = CapturingAgent(now)
        service(agent, fullPrefs, emptyList(), end = start, fixedVisits = emptyList(), clock = Clock.fixed(Instant.parse("2026-08-01T12:30:00Z"), ZoneOffset.UTC))
            .generate(acc, tripId, GenerationMode.FULLY_AI)

        agent.captures.single().timeWindows shouldContainExactly listOf(TimeWindow(start, LocalTime.parse("22:00"), LocalTime.parse("01:00")))
    }

    "밤 10시 반에 만들어도 오늘은 23:00~익일 01:00 으로 연다 — 종전엔 59분이라 닫혀 1일차가 비었다" {
        val agent = CapturingAgent(now)
        service(agent, fullPrefs, emptyList(), end = start, fixedVisits = emptyList(), clock = Clock.fixed(Instant.parse("2026-08-01T13:30:00Z"), ZoneOffset.UTC))
            .generate(acc, tripId, GenerationMode.FULLY_AI)

        agent.captures.single().timeWindows shouldContainExactly listOf(TimeWindow(start, LocalTime.parse("23:00"), LocalTime.parse("01:00")))
    }

    "당일치기를 저녁 8시에 만들면 AI 를 불러 오늘을 채운다 — 빈 일정을 내지 않는다" {
        val agent = CapturingAgent(now)
        service(agent, fullPrefs, emptyList(), end = start, fixedVisits = emptyList(), clock = Clock.fixed(Instant.parse("2026-08-01T11:04:00Z"), ZoneOffset.UTC))
            .generate(acc, tripId, GenerationMode.FULLY_AI)

        agent.captures.size shouldBe 1
        agent.captures[0].timeWindows shouldContainExactly listOf(TimeWindow(start, LocalTime.parse("21:00"), LocalTime.parse("23:59")))
    }

    "사용자가 정한 귀가 시각은 늘리지 않는다 — 남은 시간이 없으면 오늘은 닫힌다" {
        val agent = CapturingAgent(now)
        service(
            agent, fullPrefs, emptyList(), end = start, fixedVisits = emptyList(), lastDayEndAt = LocalTime.parse("21:00"),
            clock = Clock.fixed(Instant.parse("2026-08-01T11:04:00Z"), ZoneOffset.UTC),
        ).generate(acc, tripId, GenerationMode.FULLY_AI)

        agent.captures.size shouldBe 0
    }

    "출발일이라도 아직 하루 시작 전이면 창은 그대로다" {
        val agent = CapturingAgent(now)
        service(agent, fullPrefs, emptyList(), fixedVisits = emptyList(), clock = Clock.fixed(Instant.parse("2026-07-31T23:00:00Z"), ZoneOffset.UTC))
            .generate(acc, tripId, GenerationMode.FULLY_AI)

        agent.captures[0].timeWindows.first { it.date == start }.start shouldBe LocalTime.parse("09:00") // 08:00 KST
    }

    "오늘 남은 시간이 없으면 오늘은 빈 날로 두고 1차가 내일을 맡는다 — 보낼 창이 없는 1차를 만들지 않는다" {
        val agent = CapturingAgent(now)
        val repo = FakeItineraries()
        // 23:20 → 23:50 을 올리면 자정 — 오늘 열 시각이 없어 닫는다(22:30 은 이제 23:00~익일 01:00 으로 열린다).
        service(agent, fullPrefs, emptyList(), repo = repo, fixedVisits = emptyList(), clock = Clock.fixed(Instant.parse("2026-08-01T14:20:00Z"), ZoneOffset.UTC))
            .generate(acc, tripId, GenerationMode.FULLY_AI)

        agent.captures.flatMap { it.timeWindows }.none { it.date == start } shouldBe true
        agent.captures[0].timeWindows.map { it.date } shouldContainExactly listOf(start.plusDays(1))
        agent.captures[1].timeWindows.map { it.date } shouldContainExactly listOf(end)
        // 오늘이 일정에서 빠지면 일자 순서가 하루씩 밀린다 — 빈 날로 자리를 지킨다.
        val days = repo.byTrip.getValue(tripId).days
        days.map { it.date } shouldContainExactly listOf(start, start.plusDays(1), end)
        days.first().slots shouldBe emptyList()
    }

    "닫힌 오늘에 늦은 고정이 있으면 1차는 오늘 하나만 맡는다 — AI 는 요청당 창 하나를 전 일자에 쓴다" {
        val late = UUID.randomUUID()
        val agent = CapturingAgent(now)
        service(
            agent, fullPrefs, emptyList(), fixedVisits = listOf(FixedVisit(late, start, LocalTime.parse("22:00"), 60)),
            clock = Clock.fixed(Instant.parse("2026-08-01T14:20:00Z"), ZoneOffset.UTC), // 23:20 KST — 오늘은 닫힌다(22:30 은 이제 익일 01:00 까지 열린다)
        ).generate(acc, tripId, GenerationMode.FULLY_AI)

        // 오늘·내일이 한 요청에 실리면 내일까지 21:00~23:00 으로 짜인다.
        agent.captures[0].timeWindows shouldContainExactly listOf(TimeWindow(start, LocalTime.parse("21:00"), LocalTime.parse("23:00")))
    }

    "하루 여행을 그날 밤에 만들면 AI 를 부르지 않고 빈 하루로 둔다 — 실패가 아니므로 폴백 표시도 없다" {
        val agent = CapturingAgent(now)
        val repo = FakeItineraries()
        service(agent, fullPrefs, emptyList(), repo = repo, end = start, fixedVisits = emptyList(), clock = Clock.fixed(Instant.parse("2026-08-01T14:20:00Z"), ZoneOffset.UTC)) // 23:20 KST — 열 시각이 자정을 넘는다
            .generate(acc, tripId, GenerationMode.FULLY_AI)

        agent.captures.size shouldBe 0
        val saved = repo.byTrip.getValue(tripId)
        saved.days.map { it.date } shouldContainExactly listOf(start)
        saved.isFallback shouldBe false
    }

    // 처음 만들기는 출발일만 자른다 — 실 시계로 "어제 출발" 여행을 처음 만드는 통합 테스트(재계획·트리거)가
    // 오늘 슬롯을 쓰므로, 여기까지 자르면 밤에 돌린 CI 에서 오늘이 비어 결과가 시각에 따라 갈린다.
    "어제 출발한 여행을 오늘 밤 처음 만들면 종전 그대로다 — 오늘 자르기는 출발일과 재생성에만" {
        val agent = CapturingAgent(now)
        val repo = FakeItineraries()
        service(agent, fullPrefs, emptyList(), repo = repo, fixedVisits = emptyList(), clock = Clock.fixed(Instant.parse("2026-08-02T11:40:00Z"), ZoneOffset.UTC))
            .generate(acc, tripId, GenerationMode.FULLY_AI)

        agent.captures.flatMap { it.timeWindows }.forEach { it.start shouldBe LocalTime.parse("09:00") }
        repo.byTrip.getValue(tripId).days.map { it.date } shouldContainExactly listOf(start, start.plusDays(1), end)
    }

    "출발일 어느 시각에 만들어도 오늘 창은 지금 뒤에 열리고, 일자는 하나도 빠지지 않는다 (PBT)" {
        checkAll(Arb.int(0, 24 * 60 - 1)) { minuteOfDay ->
            val agent = CapturingAgent(now)
            val repo = FakeItineraries()
            val nowKst = LocalTime.ofSecondOfDay(minuteOfDay * 60L)
            val at = start.atTime(nowKst).atZone(java.time.ZoneId.of("Asia/Seoul")).toInstant()
            service(agent, fullPrefs, emptyList(), repo = repo, fixedVisits = emptyList(), clock = Clock.fixed(at, ZoneOffset.UTC))
                .generate(acc, tripId, GenerationMode.FULLY_AI)

            withClue("now=$nowKst") {
                agent.captures.flatMap { it.timeWindows }.forEach { TodayWindow.isOpen(it.start, it.end) shouldBe true } // AI 는 빈 창을 422 로 거절한다(새벽 끝은 다음 날)
                agent.captures.flatMap { it.timeWindows }.filter { it.date == start }.forEach {
                    it.start.isAfter(nowKst) shouldBe true
                    (TodayWindow.spanMinutes(it.start, it.end) >= 60) shouldBe true // 한 곳도 못 넣는 창은 보내지 않는다
                }
                repo.byTrip.getValue(tripId).days.map { it.date } shouldContainExactly listOf(start, start.plusDays(1), end)
            }
        }
    }

    "ANYTIME 은 날짜만 채워 경계로 나간다 (M1 · TRIP-1249) — 시각은 비워 조립이 영업시간 안에서 고른다" {
        val anytime = UUID.randomUUID()
        val agent = CapturingAgent(now)
        service(agent, fullPrefs, emptyList(), fixedVisits = listOf(FixedVisit(anytime, null, null, null)))
            .generate(acc, tripId, GenerationMode.FULLY_AI)

        val block = agent.captures[1].fixedBlocks.single { it.poiId == anytime }
        block.date shouldBe start.plusDays(1) // 2차 몫 가운데 가장 이른 한산한 날
        block.start shouldBe null             // 09:00 에 못 박으면 그 시각에 닫힌 식당이 조립을 409 로 죽였다
    }

    "구형 AI 가 start=null 을 422 로 거부하면(배포 순서 역전) 2차만 MINIMAL 폴백이 되고 day1 과 필수 방문지는 남는다" {
        // '여행 전체가 폴백'이 아니라 **day1 은 실 AI 결과, 나머지 일자만 MINIMAL** 이고 상태는 COMPLETE(isFallback=true) 다.
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
        // 폴백에도 필수 방문지는 **그 날**에 남는다 — 날짜만 있는 블록을 폴백이 몰라 조용히 버리던 구멍(TRIP-1249).
        val fallbackSlot = saved.days.drop(1).flatMap { it.slots }.single { it.sourcePoiId == anytime }
        fallbackSlot.isFixed shouldBe false // 시각은 사용자가 정하지 않았다
    }

    "하루 여행에서 저녁 고정 뒤에 안 들어가는 ANYTIME 은 AI 가 실패해도 사라지지 않는다 — 폴백이 보고하고 COMPLETE 에 남는다" {
        // 19:00/90 저녁 뒤 60분은 21:00 창 밖이고 넘길 다음 날도 없다. 종전엔 폴백이 버리고, 하루 여행 마무리가 1차 보고를
        // 빈 목록으로 덮어 일정에도 보고에도 없이 사라졌다(INV-4 침묵 실패 — TRIP-1249 리뷰 실측).
        val dinner = UUID.randomUUID()
        val anytime = UUID.randomUUID()
        val repo = FakeItineraries()
        service(
            ThrowingAgent(), fullPrefs, emptyList(), repo = repo, end = start,
            fixedVisits = listOf(FixedVisit(dinner, start, LocalTime.parse("19:00"), 90), FixedVisit(anytime, null, null, 60)),
        ).generate(acc, tripId, GenerationMode.FULLY_AI)

        val saved = repo.findByTrip(tripId).single()
        saved.generationState shouldBe GenerationState.COMPLETE
        saved.days.single().slots.map { it.sourcePoiId } shouldBe listOf(dinner)
        saved.unplacedMustVisits shouldBe listOf(UnplacedMustVisit(anytime, UnplacedReason.NO_FEASIBLE_SLOT))
    }

    "하루 여행의 조립 단계 미배치 보고는 COMPLETE 까지 남는다 — 2차가 없다고 빈 목록으로 덮으면 사라진다" {
        // 09:00/660 고정이 12시간 창의 11시간을 차지해 2시간 ANYTIME 은 넣을 날이 없다(물질화 NO_FEASIBLE_SLOT).
        // 하루 여행은 ANYTIME 이 1차에 실리므로(carriesUndatedFixed) 이 보고가 유일한 M2 채널이다.
        val full = UUID.randomUUID()
        val anytime = UUID.randomUUID()
        val agent = CapturingAgent(now)
        val repo = FakeItineraries()
        val returned = service(
            agent, fullPrefs, emptyList(), repo = repo, end = start,
            fixedVisits = listOf(FixedVisit(full, start, LocalTime.parse("09:00"), 660), FixedVisit(anytime, null, null, 120)),
        ).generate(acc, tripId, GenerationMode.FULLY_AI)

        agent.captures.single().fixedBlocks.map { it.poiId } shouldBe listOf(full) // ANYTIME 은 보내지 않았다
        returned.unplacedMustVisits.map { it.poiId } shouldBe listOf(anytime)     // 201 본문(PARTIAL)에는 있었다
        val saved = repo.findByTrip(tripId).single()
        saved.generationState shouldBe GenerationState.COMPLETE
        saved.unplacedMustVisits shouldBe listOf(UnplacedMustVisit(anytime, UnplacedReason.NO_FEASIBLE_SLOT))
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
    // ── 재생성 가드(여행 기간 × 다녀온 기록) ─────────────────────────────────
    //
    // 재생성은 기존 일정을 지우고 새로 만든다. 다녀온 기록이 있는 여행에서 그러면 **방문 실적이 유령이
    // 된다** — visit_check 는 trip_id+slotKey 로 남아 삭제를 견딘다. 그런 여행의 변경은 재계획(Plan-B)의 몫이다.
    //
    // **첫 생성과 기록 없는 재생성은 대상이 아니다** — 지울 계획이나 남을 기록이 없으면 이 피해가 성립하지
    // 않는다. 그래서 아래 케이스들은 기존 일정을 미리 깔고 시작한다(그게 "재생성"의 정의다).

    fun clockAt(day: String): Clock = Clock.fixed(Instant.parse("${day}T00:00:00Z"), ZoneOffset.UTC)

    /** 이미 일정이 있는 상태 — 재생성 경로로 들어가게 한다. */
    fun repoWithExisting(): FakeItineraries = FakeItineraries().apply {
        byTrip[tripId] = Itinerary.create(
            tripId, SolveMode.FULL_AI, GenerationMode.FULLY_AI, false,
            listOf(ItineraryDay.of(start, 0, emptyList())),
            now, GenerationState.COMPLETE,
        )
    }

    // ── 거절 이력 (TRIP-964) ────────────────────────────────────────────────

    /**
     * **재생성 = 직전 배치 전부에 대한 약한 거절.** 그리고 **바로 이번 생성이 첫 소비처다** —
     * 기록만 하고 입력에 안 실으면 "다시 짜줘"가 같은 구성을 그대로 다시 내놓는다(이 티켓의
     * 출발점이 된 사용자 요청이 정확히 그 불만이다).
     */
    "재생성이 직전 배치를 REGENERATED 로 기록하고 이번 입력에 싣는다" {
        val placed = UUID.randomUUID()
        val repo = FakeItineraries().apply {
            byTrip[tripId] = Itinerary.create(
                tripId, SolveMode.FULL_AI, GenerationMode.FULLY_AI, false,
                listOf(ItineraryDay.of(start, 0, listOf(VisitSlot.of(placed, null, 0, LocalTime.parse("10:00"), LocalTime.parse("11:00"))))),
                now, GenerationState.COMPLETE,
            )
        }
        val store = FakeRejectionStore()
        val agent = CapturingAgent(now)

        service(agent, fullPrefs, emptyList(), repo = repo, clock = clockAt("2026-07-31"), rejectionStore = store)
            .generate(acc, tripId, GenerationMode.FULLY_AI)

        store.findByTrip(tripId) shouldBe listOf(RejectedPoi(placed, RejectedPoi.Kind.REGENERATED, 1))
        agent.captured!!.rejections shouldBe listOf(RejectedPoi(placed, RejectedPoi.Kind.REGENERATED, 1))
    }

    /**
     * **직접 만들기로 갈아타는 것도 재생성이다.** MANUAL 갈래는 조기 반환이라 공용 기록 지점을
     * 안 지난다 — 검수에서 실제로 빠뜨렸던 자리라, 이 스펙이 그 갈래를 따로 지킨다.
     */
    "기존 일정을 두고 직접 만들기로 갈아타면 직전 배치가 REGENERATED 로 쌓인다" {
        val placed = UUID.randomUUID()
        val repo = FakeItineraries().apply {
            byTrip[tripId] = Itinerary.create(
                tripId, SolveMode.FULL_AI, GenerationMode.FULLY_AI, false,
                listOf(ItineraryDay.of(start, 0, listOf(VisitSlot.of(placed, null, 0, LocalTime.parse("10:00"), LocalTime.parse("11:00"))))),
                now, GenerationState.COMPLETE,
            )
        }
        val store = FakeRejectionStore()

        service(CapturingAgent(now), fullPrefs, emptyList(), repo = repo, clock = clockAt("2026-07-31"), rejectionStore = store)
            .generate(acc, tripId, GenerationMode.MANUAL)

        store.findByTrip(tripId) shouldBe listOf(RejectedPoi(placed, RejectedPoi.Kind.REGENERATED, 1))
    }

    /** 첫 생성에는 지운 계획이 없다 — 거절이 성립하지 않는다. */
    "첫 생성은 아무 거절도 기록하지 않는다" {
        val store = FakeRejectionStore()
        val agent = CapturingAgent(now)

        service(agent, fullPrefs, emptyList(), rejectionStore = store).generate(acc, tripId, GenerationMode.FULLY_AI)

        store.byTrip shouldBe emptyMap()
        agent.captured!!.rejections shouldBe emptyList()
    }

    "여행 시작 전이면 재생성된다" {
        val svc = service(CapturingAgent(now), fullPrefs, emptyList(), repo = repoWithExisting(), clock = clockAt("2026-07-31"))

        svc.generate(acc, tripId, GenerationMode.FULLY_AI).tripId shouldBe tripId
    }

    // 경계값 — 시작 당일은 이미 "여행 중"이다. 다녀온 기록이 있으면 통째로 다시 짜지 않는다.
    "다녀온 기록이 있으면 여행 시작 당일 409" {
        val svc = service(CapturingAgent(now), fullPrefs, emptyList(), repo = repoWithExisting(), clock = clockAt("2026-08-01"), visits = Visited)

        shouldThrow<ConflictDetected> { svc.generate(acc, tripId, GenerationMode.FULLY_AI) }
            .message.orEmpty() shouldContain "재계획"
    }

    "다녀온 기록이 있으면 여행 중 409" {
        val svc = service(CapturingAgent(now), fullPrefs, emptyList(), repo = repoWithExisting(), clock = clockAt("2026-08-02"), visits = Visited)

        shouldThrow<ConflictDetected> { svc.generate(acc, tripId, GenerationMode.FULLY_AI) }
    }

    // 경계값 — 마지막 날도 여행 중이다(체크아웃일까지 계획일에 포함된다).
    "다녀온 기록이 있으면 여행 마지막 날 409" {
        val svc = service(CapturingAgent(now), fullPrefs, emptyList(), repo = repoWithExisting(), clock = clockAt("2026-08-03"), visits = Visited)

        shouldThrow<ConflictDetected> { svc.generate(acc, tripId, GenerationMode.FULLY_AI) }
    }

    "다녀온 기록이 있으면 끝난 여행 409 — 문구가 다르다" {
        val svc = service(CapturingAgent(now), fullPrefs, emptyList(), repo = repoWithExisting(), clock = clockAt("2026-08-04"), visits = Visited)

        shouldThrow<ConflictDetected> { svc.generate(acc, tripId, GenerationMode.FULLY_AI) }
            .message.orEmpty() shouldContain "끝난 여행"
    }

    /**
     * 오늘 출발 여행을 만들고 추천안에서 바로 [다시 짜기] — 날짜만 보던 가드가 409 를 냈고, 옛 앱은 그것을
     * "네트워크 확인"으로 접어 사용자가 연타했다(DEV 10-13 6회 · 10-14 7회). 지킬 기록이 없으니 다시 만든다.
     */
    "다녀온 기록이 없으면 여행 시작 당일에도 다시 만든다" {
        val svc = service(CapturingAgent(now), fullPrefs, emptyList(), repo = repoWithExisting(), clock = clockAt("2026-08-01"))

        svc.generate(acc, tripId, GenerationMode.FULLY_AI).tripId shouldBe tripId
    }

    "다녀온 기록이 없으면 여행 중·끝난 여행도 다시 만든다" {
        listOf("2026-08-02", "2026-08-04").forEach { day ->
            val svc = service(CapturingAgent(now), fullPrefs, emptyList(), repo = repoWithExisting(), clock = clockAt(day))

            withClue(day) { svc.generate(acc, tripId, GenerationMode.FULLY_AI).tripId shouldBe tripId }
        }
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
        val svc = service(CapturingAgent(now), fullPrefs, emptyList(), repo = failedRepo, clock = clockAt("2026-08-02"), visits = Visited)

        svc.generate(acc, tripId, GenerationMode.FULLY_AI).tripId shouldBe tripId
    }

    "직접 만들기도 다녀온 기록이 있으면 여행 중 409" {
        val svc = service(CapturingAgent(now), fullPrefs, emptyList(), repo = repoWithExisting(), clock = clockAt("2026-08-02"), visits = Visited)

        shouldThrow<ConflictDetected> { svc.generate(acc, tripId, GenerationMode.MANUAL) }
    }

    // 여행 중 **재생성**(BE #1183 — 다녀온 기록이 없으면 허용)도 오늘을 지금부터 연다. 출발일이 아니어도.
    // 시각은 KST, 여행은 08-01~08-03 이고 오늘은 둘째 날(08-02).

    "여행 중에 다시 만들면 출발일이 아니어도 오늘은 지금부터 연다" {
        val agent = CapturingAgent(now)
        service(agent, fullPrefs, emptyList(), repo = repoWithExisting(), fixedVisits = emptyList(), clock = Clock.fixed(Instant.parse("2026-08-02T09:10:00Z"), ZoneOffset.UTC))
            .generate(acc, tripId, GenerationMode.FULLY_AI)

        val windows = agent.captures.flatMap { it.timeWindows }
        windows.single { it.date == start.plusDays(1) } shouldBe TimeWindow(start.plusDays(1), LocalTime.parse("19:00"), LocalTime.parse("23:00")) // 18:10 KST, 끝은 지금부터 4시간
        windows.filter { it.date != start.plusDays(1) }.forEach { it.start shouldBe LocalTime.parse("09:00") } // 다른 날은 그대로
    }

    "여행 중에 다시 만들 때 오늘 남은 시간이 없으면 오늘은 빈 날로 자리를 지킨다 — 2차가 그 날을 빼지 않는다" {
        val agent = CapturingAgent(now)
        val repo = repoWithExisting()
        service(agent, fullPrefs, emptyList(), repo = repo, fixedVisits = emptyList(), clock = Clock.fixed(Instant.parse("2026-08-02T14:20:00Z"), ZoneOffset.UTC))
            .generate(acc, tripId, GenerationMode.FULLY_AI)

        agent.captures.flatMap { it.timeWindows }.none { it.date == start.plusDays(1) } shouldBe true // 23:20 KST — 닫힌 오늘은 경계로 안 나간다
        val days = repo.byTrip.getValue(tripId).days
        days.map { it.date } shouldContainExactly listOf(start, start.plusDays(1), end)
        days[1].slots shouldBe emptyList()
    }

    "마지막 날 밤에 다시 만들면 남은 날이 모두 닫혀 2차는 AI 를 부르지 않는다 — 실패가 아니므로 폴백 표시도 없다" {
        val agent = CapturingAgent(now)
        val repo = repoWithExisting()
        service(agent, fullPrefs, emptyList(), repo = repo, end = start.plusDays(1), fixedVisits = emptyList(), clock = Clock.fixed(Instant.parse("2026-08-02T14:20:00Z"), ZoneOffset.UTC)) // 23:20 KST
            .generate(acc, tripId, GenerationMode.FULLY_AI)

        agent.captures.map { c -> c.timeWindows.map { it.date } } shouldContainExactly listOf(listOf(start)) // 1차(어제)만
        val saved = repo.byTrip.getValue(tripId)
        saved.days.map { it.date } shouldContainExactly listOf(start, start.plusDays(1))
        saved.isFallback shouldBe false
    }

    "여행 중 어느 시각에 다시 만들어도 오늘 창은 지금 뒤에 열리고, 일자는 하나도 빠지지 않는다 (PBT)" {
        checkAll(Arb.int(0, 24 * 60 - 1)) { minuteOfDay ->
            val agent = CapturingAgent(now)
            val repo = repoWithExisting()
            val today = start.plusDays(1)
            val nowKst = LocalTime.ofSecondOfDay(minuteOfDay * 60L)
            val at = today.atTime(nowKst).atZone(java.time.ZoneId.of("Asia/Seoul")).toInstant()
            service(agent, fullPrefs, emptyList(), repo = repo, fixedVisits = emptyList(), clock = Clock.fixed(at, ZoneOffset.UTC))
                .generate(acc, tripId, GenerationMode.FULLY_AI)

            withClue("now=$nowKst") {
                agent.captures.flatMap { it.timeWindows }.forEach { TodayWindow.isOpen(it.start, it.end) shouldBe true } // AI 는 빈 창을 422 로 거절한다(새벽 끝은 다음 날)
                agent.captures.flatMap { it.timeWindows }.filter { it.date == today }.forEach { it.start.isAfter(nowKst) shouldBe true }
                repo.byTrip.getValue(tripId).days.map { it.date } shouldContainExactly listOf(start, today, end)
            }
        }
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
                          destinations = refs("좌표없는곳"))

        svc.generate(acc, tripId, GenerationMode.FULLY_AI)

        agent.captured!!.anchors.isEmpty() shouldBe true
    }

    // ── 다목적지 날짜별 앵커 ────────────────────
    /**
     * **숙소 없는 날의 앵커는 그 날의 목적지 중심이다.** 박수가 실려 오지 않던 때는 모든 날이 첫
     * 목적지로 접혀 "서울 1박 + 인천 1박"이 서울 2박처럼 나왔다. 날짜→목적지 규칙은 FE
     * `frontend/src/entities/trip/lib/regionForDay.ts`(`regionForDay`)와 같다 — seq 순서로 박수만큼, 넘치는 날(체크아웃일)은 마지막 목적지.
     * 1차(day1)·2차(나머지)가 각자 자기 날짜의 앵커를 싣는지도 함께 본다.
     */
    "서울 1박 + 인천 1박, 숙소 미등록 — 1일차는 서울 중심, 2·3일차는 인천 중심" {
        val agent = CapturingAgent(now)
        service(
            agent, fullPrefs, anchors = emptyList(), fixedVisits = emptyList(),
            destinations = listOf(TripDestinationRef("서울", null, 1), TripDestinationRef("인천", null, 1)),
        ).generate(acc, tripId, GenerationMode.FULLY_AI)

        agent.captures[0].anchors shouldContainExactly listOf(DayAnchor(start, SEOUL.lat, SEOUL.lng))
        agent.captures[1].anchors shouldContainExactly listOf(
            DayAnchor(start.plusDays(1), INCHEON.lat, INCHEON.lng),
            DayAnchor(end, INCHEON.lat, INCHEON.lng),
        )
    }

    "숙소가 있는 날은 목적지 중심보다 숙소가 이긴다" {
        val agent = CapturingAgent(now)
        val stay = DayAnchorView(start.plusDays(1), 37.4400, 126.4500) // 인천 날(08-02)의 숙소
        service(
            agent, fullPrefs, anchors = listOf(stay), fixedVisits = emptyList(),
            destinations = listOf(TripDestinationRef("서울", null, 1), TripDestinationRef("인천", null, 1)),
        ).generate(acc, tripId, GenerationMode.FULLY_AI)

        agent.captures[0].anchors shouldContainExactly listOf(DayAnchor(start, SEOUL.lat, SEOUL.lng))
        agent.captures[1].anchors shouldContainExactly listOf(
            DayAnchor(start.plusDays(1), stay.lat, stay.lng),
            DayAnchor(end, stay.lat, stay.lng), // 체크아웃일 = 전날 거점(prev_stay)
        )
    }

    /** 그 날 목적지의 좌표가 없으면 첫 목적지 중심으로 — 앵커를 잃지도, 지어내지도 않는다. */
    "그 날 목적지 좌표가 없으면 첫 목적지 중심으로 떨어진다" {
        val agent = CapturingAgent(now)
        service(
            agent, fullPrefs, anchors = emptyList(), fixedVisits = emptyList(),
            destinations = listOf(TripDestinationRef("서울", null, 1), TripDestinationRef("좌표없는곳", null, 1)),
        ).generate(acc, tripId, GenerationMode.FULLY_AI)

        agent.captures[1].anchors shouldContainExactly listOf(
            DayAnchor(start.plusDays(1), SEOUL.lat, SEOUL.lng),
            DayAnchor(end, SEOUL.lat, SEOUL.lng),
        )
    }

    /**
     * 박수 합 == 일수-1(꽉 찬 여행)이면 날짜→목적지가 **seq 단조**이고, 목적지마다 자기 박수만큼의 날을
     * 갖는다(마지막 목적지는 체크아웃일 하루를 더). 단조가 깨지면 일정이 도시를 오간다.
     */
    "속성: 날짜→목적지는 seq 단조이고 목적지마다 박수만큼의 날을 갖는다" {
        checkAll(Arb.list(Arb.int(0..4), 1..5)) { nights ->
            val refs = nights.mapIndexed { i, n -> TripDestinationRef("d$i", null, n) }
            val days = generateSequence(start) { it.plusDays(1) }.take(nights.sum() + 1).toList()

            val idx = days.map { refs.indexOf(RegionAnchors.destinationOn(refs, start, it)) }

            idx shouldBe idx.sorted()
            refs.indices.map { i -> idx.count { it == i } } shouldBe
                nights.mapIndexed { i, n -> if (i == refs.lastIndex) n + 1 else n }
        }
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
        scoredPools: ScoredCandidatePoolStore = FakeScoredCandidatePoolStore(),
        tripSnapshot: Map<String, Any?> = emptyMap(),
        accountPrefs: () -> PreferenceSnapshot = { prefs },
    ): GenerateItineraryService {
        val trips = object : TripFacade {
            override fun findPeriod(accountId: UUID, tripId: UUID) = TripPeriod(start, end)
            override fun findGenerationContext(accountId: UUID, tripId: UUID) =
                TripGenerationContext(start, end, refs("제주"), "친구", 500_000, emptyList())
        }
        val preferences = object : PreferenceFacade {
            override fun findPreferences(accountId: UUID) = accountPrefs()
        }
        val baseAnchors = object : BaseAnchorFacade {
            override fun findStayNightAnchors(tripId: UUID, startDate: LocalDate, endDate: LocalDate) = emptyList<DayAnchorView>()
        }
        // 1차·2차가 **같은 세션**을 봐야 취소가 2차에 전달된다.
        val sessions = genSessions(trips, sessionRepo, clock, deadlines)
        val second = SecondPhaseGenerator(agent, repo, genRevisions(repo, trips), sessions, scoredPools, NOOP_TX, clock)
        return GenerateItineraryService(trips, preferences, baseAnchors, agent, repo, CapturingPublisher(), second, sessions, genRevisions(repo, trips), StubRegions, FakeRejectionStore(), scoredPools, NoPersonalization, NoVisits, NOOP_TX, clock, deadlines)
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
            override fun explanations(tripId: UUID, solution: ScheduleAgentOutput, preference: PreferenceProfile?, companionType: String?): SlotExplanations = SlotExplanations()
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

    // ───── 점수 후보 풀 저장(TRIP-969) ─────────────────────────────────────

    "생성이 점수 후보 풀을 저장한다 — 1차 갈아끼움 + 2차 합침, 반경은 큰 쪽" {
        val end = start.plusDays(1)
        val poiA = UUID.randomUUID()
        val poiB = UUID.randomUUID()
        val agent = CapturingAgent(now, scored = { input ->
            if (input.timeWindows.first().date == start) {
                ScoredCandidatePool(3_000, listOf(ScoredCandidate(poiA, 0.9, "카페")))
            } else {
                ScoredCandidatePool(5_000, listOf(ScoredCandidate(poiB, 0.8, "명소")))
            }
        })
        val store = FakeScoredCandidatePoolStore().apply {
            // 이전 생성의 풀 — 1차가 갈아끼워야 한다(합치면 낡은 판단이 섞인다).
            replace(tripId, ScoredCandidatePool(9_000, listOf(ScoredCandidate(UUID.randomUUID(), 0.5, "맛집"))))
        }
        service(agent, FakeItineraries(), end, scoredPools = store).generate(acc, tripId, GenerationMode.FULLY_AI)

        val saved = store.find(tripId)!!
        saved.radiusM shouldBe 5_000 // 두 호출 중 큰 쪽
        saved.candidates.map { it.poiId }.toSet() shouldBe setOf(poiA, poiB) // 이전 생성 몫은 없다
    }

    "풀 없이 온 생성은 이전 풀을 지운다 — 낡은 판단으로 즉답하지 않게" {
        val end = start.plusDays(1)
        val (agent, _) = emittingAgent(end) // scoredCandidates = null (http 미개통·옛 응답)
        val store = FakeScoredCandidatePoolStore().apply {
            replace(tripId, ScoredCandidatePool(9_000, listOf(ScoredCandidate(UUID.randomUUID(), 0.5, "맛집"))))
        }
        service(agent, FakeItineraries(), end, scoredPools = store).generate(acc, tripId, GenerationMode.FULLY_AI)

        store.find(tripId) shouldBe null
    }

    "직접 만들기 전환도 풀을 지운다 — 빈 일정에 이전 생성의 판단이 남지 않게" {
        val end = start.plusDays(1)
        val (agent, _) = emittingAgent(end)
        val store = FakeScoredCandidatePoolStore().apply {
            replace(tripId, ScoredCandidatePool(9_000, listOf(ScoredCandidate(UUID.randomUUID(), 0.5, "맛집"))))
        }
        service(agent, FakeItineraries(), end, scoredPools = store).generate(acc, tripId, GenerationMode.MANUAL)

        store.find(tripId) shouldBe null
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

            override fun explanations(tripId: UUID, solution: ScheduleAgentOutput, preference: PreferenceProfile?, companionType: String?) =
                SlotExplanations(slots = poiByDate.entries.associate { (d, p) -> "$d#$p" to "$d 근거" })
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
     * **기본이 시한을 싣는다**(TRIP-1000 재도입 · BR-U3-03 "deadlineMs 는 backend 소유").
     * 안 실으면 AI 가 600초를 대입해, 몰아 재시도가 겹치면 2차가 10분이 된다(QA #073).
     */
    "기본 설정에서 1차 15s · 2차 60s 시한을 싣는다(TRIP-1000)" {
        val end = start.plusDays(2)
        val (agent, _) = emittingAgent(end)
        service(agent, FakeItineraries(), end).generate(acc, tripId, GenerationMode.FULLY_AI)

        agent.captures[0].requestMeta.deadlineMs shouldBe 15_000L
        agent.captures[1].requestMeta.deadlineMs shouldBe 60_000L
    }

    /** 끄면 무제한(미지정)으로 돌아간다 — 재도입 전 동작을 환경값 한 줄로 되살릴 수 있어야 한다. */
    "플래그를 끄면 시한을 싣지 않는다" {
        val end = start.plusDays(2)
        val (agent, _) = emittingAgent(end)
        service(agent, FakeItineraries(), end, deadlines = ScheduleDeadlineProperties(enforced = false))
            .generate(acc, tripId, GenerationMode.FULLY_AI)

        agent.captures[0].requestMeta.deadlineMs shouldBe null
        agent.captures[1].requestMeta.deadlineMs shouldBe null
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
            override fun explanations(tripId: UUID, solution: ScheduleAgentOutput, preference: PreferenceProfile?, companionType: String?) = SlotExplanations(
                slots = solution.days.flatMap { d -> d.slots.map { "${d.date}#${it.poiId}" to "${d.date} 근거" } }.toMap(),
            )
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

    /**
     * **차선책 문장이 슬롯까지 닿는다**(TRIP-873 · AI TRIP-887) — 배선 세 칸을 한 번에 지킨다.
     *
     * 이 경로는 **세 곳 중 하나만 빠져도 조용히 꺼진다**:
     * 1. `toOutput()` 이 저장된 차선책을 요청에 안 실으면 → 상대가 만들 재료가 없다
     * 2. `toWire()` 가 그것을 경계 본문에 안 실으면 → 같은 결과
     * 3. 적용이 빠지면 → 받아 놓고 버린다
     *
     * 셋 다 증상이 같다 — 화면의 "다른 선택지" 이유가 AI 템플릿 문구(`"같은 카페 후보"`)에 머문다.
     * **그건 정상 폴백과 구분되지 않아** 아무도 눈치채지 못한다. 그래서 요청에 실렸는지(대역이 단언)와
     * 응답이 적용됐는지(저장분 단정)를 **양쪽에서** 본다.
     */
    "차선책 문장이 요청에 실려 나가고 받은 문장이 슬롯에 붙는다" {
        val end = start.plusDays(1)
        val poiByDate = generateSequence(start) { it.plusDays(1) }.takeWhile { !it.isAfter(end) }
            .associateWith { UUID.randomUUID() }
        val altPoi = UUID.randomUUID()
        var sentAlternatives = 0
        val agent = object : StubScheduleAgent() {
            override fun generate(input: ScheduleAgentInput) = ScheduleAgentOutput(
                days = input.timeWindows.map { tw ->
                    DaySchedule(
                        tw.date,
                        listOf(
                            VisitSlotDisplay(
                                poiByDate.getValue(tw.date), LocalTime.parse("10:00"), LocalTime.parse("11:00"),
                                false, null, isFixed = false,
                                alternatives = listOf(SlotAlternative(altPoi, "같은 카페 후보", null)),
                            ),
                        ),
                    )
                },
                day1ReadyAt = null, explanations = emptyMap(),
                solveMode = SolveMode.DETERMINISTIC, isFallback = false,
                freshness = FreshnessMeta(now, degraded = false),
            )

            override fun explanations(tripId: UUID, solution: ScheduleAgentOutput, preference: PreferenceProfile?, companionType: String?): SlotExplanations {
                // 요청에 실려 왔는가 — 여기가 0 이면 위 1·2번이 끊긴 것이다.
                sentAlternatives = solution.days.sumOf { d -> d.slots.sumOf { it.alternatives.size } }
                return SlotExplanations(
                    alternatives = solution.days
                        .flatMap { d -> d.slots.flatMap { s -> s.alternatives.map { "${d.date}#${it.poiId}" to "비 오면 여기가 나아요" } } }
                        .toMap(),
                )
            }

            override fun validate(solution: ScheduleAgentOutput): List<Violation> = emptyList()
            override fun repair(solution: ScheduleAgentOutput, violations: List<Violation>) = RepairResult(solution, emptyList())
        }
        val repo = FakeItineraries()

        service(agent, repo, end).generate(acc, tripId, GenerationMode.FULLY_AI)

        withClue("요청 슬롯에 차선책이 하나도 안 실렸습니다 — toOutput() 이나 toWire() 가 끊긴 것입니다.") {
            sentAlternatives shouldBe poiByDate.size
        }
        val saved = repo.byTrip.getValue(tripId)
        withClue("문장을 받았는데 슬롯의 rationale 이 AI 템플릿 그대로입니다 — 적용이 끊긴 것입니다.") {
            saved.days.flatMap { it.slots }.flatMap { it.alternatives }.map { it.rationale }
                .toSet() shouldBe setOf("비 오면 여기가 나아요")
        }
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
            override fun explanations(tripId: UUID, solution: ScheduleAgentOutput, preference: PreferenceProfile?, companionType: String?): SlotExplanations = SlotExplanations()
        }
        val repo = FakeItineraries()
        service(agent, repo, end, sessionRepo).generate(acc, tripId, GenerationMode.FULLY_AI)

        val stored = repo.byTrip.getValue(tripId)
        stored.days.map { it.date } shouldContainExactly listOf(start)   // 2차 일자가 붙지 않았다
        stored.generationState shouldBe GenerationState.PARTIAL
        sessionRepo.rows.values.single().status shouldBe GenerationStatus.CANCELED
    }

    /**
     * **1일차가 오기 전에 닫힌 세션은 409 로 끝난다 — 500 이 아니다**(TRIP-1058 · QA #029·#046).
     *
     * 재생성 연타·취소 API 가 1차 AI 호출 중에 세션을 닫으면, 뒤늦게 도착한 1일차가 day1 전이의
     * require 에서 IllegalArgumentException 으로 터져 사용자에게 500 이 나갔다. 조용히 넘기면(takeIf)
     * 낡은 1일차가 새 요청의 일정을 덮으므로 **예외는 유지하되 도메인 예외(409)** 여야 하고,
     * 화면이 갈아탈 **진행 중인 새 세션**을 함께 싣는다.
     */
    "1일차 전에 취소된 세션이면 409 도메인 예외다 — 500 이 아니다" {
        val end = start // 하루 여행 — 1차만 본다
        val sessionRepo = FakeGenerationSessions()
        var newSessionId: UUID? = null
        val agent = object : StubScheduleAgent() {
            override fun generate(input: ScheduleAgentInput): ScheduleAgentOutput {
                // 1차가 도는 사이 재생성 연타가 이 세션을 닫고 새로 열었다(QA #029 — 17:37:11.682).
                sessionRepo.findRunningByTrip(tripId)?.let { sessionRepo.save(it.canceled(now)) }
                newSessionId = sessionRepo.save(GenerationSession.start(acc, tripId, GenerationMode.FULLY_AI, now)).sessionId
                return ScheduleAgentOutput(
                    days = input.timeWindows.map { tw ->
                        DaySchedule(tw.date, listOf(VisitSlotDisplay(UUID.randomUUID(), LocalTime.parse("10:00"), LocalTime.parse("11:00"), false, null, isFixed = false)))
                    },
                    day1ReadyAt = null, explanations = emptyMap(),
                    solveMode = SolveMode.DETERMINISTIC, isFallback = false,
                    freshness = FreshnessMeta(now, degraded = false),
                )
            }
        }
        val ex = shouldThrow<ConflictDetected> {
            service(agent, FakeItineraries(), end, sessionRepo).generate(acc, tripId, GenerationMode.FULLY_AI)
        }
        ex.errorCode shouldBe ErrorCode.GENERATION_SUPERSEDED
        ex.current shouldBe newSessionId // 화면이 폴링을 갈아탈 대상
    }

    /**
     * **취소만 되고 새 요청이 없어도 같은 409 다**(QA #046 — cancel API 후 늦은 1차 도착).
     * 새 세션이 없으면 실을 것도 없다 — current 는 비운다.
     */
    "취소 후 새 요청이 없으면 409 에 새 세션 없이 끝난다" {
        val end = start
        val sessionRepo = FakeGenerationSessions()
        val agent = object : StubScheduleAgent() {
            override fun generate(input: ScheduleAgentInput): ScheduleAgentOutput {
                sessionRepo.findRunningByTrip(tripId)?.let { sessionRepo.save(it.canceled(now)) }
                return ScheduleAgentOutput(
                    days = input.timeWindows.map { tw ->
                        DaySchedule(tw.date, listOf(VisitSlotDisplay(UUID.randomUUID(), LocalTime.parse("10:00"), LocalTime.parse("11:00"), false, null, isFixed = false)))
                    },
                    day1ReadyAt = null, explanations = emptyMap(),
                    solveMode = SolveMode.DETERMINISTIC, isFallback = false,
                    freshness = FreshnessMeta(now, degraded = false),
                )
            }
        }
        val ex = shouldThrow<ConflictDetected> {
            service(agent, FakeItineraries(), end, sessionRepo).generate(acc, tripId, GenerationMode.FULLY_AI)
        }
        ex.errorCode shouldBe ErrorCode.GENERATION_SUPERSEDED
        ex.current shouldBe null
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
            override fun explanations(tripId: UUID, solution: ScheduleAgentOutput, preference: PreferenceProfile?, companionType: String?): SlotExplanations {
                // 근거를 받아 오는 **그 사이에** 사용자가 [취소]를 눌렀다.
                sessionRepo.findRunningByTrip(theTrip)?.let { sessionRepo.save(it.canceled(now)) }
                return SlotExplanations()
            }
        }
        val repo = FakeItineraries()

        service(agent, repo, end, sessionRepo).generate(acc, tripId, GenerationMode.FULLY_AI)

        val stored = repo.byTrip.getValue(tripId)
        stored.generationState shouldBe GenerationState.PARTIAL       // 마무리가 반영되지 않았다
        stored.days.map { it.date } shouldContainExactly listOf(start) // day1 은 남는다
        sessionRepo.rows.values.single().status shouldBe GenerationStatus.CANCELED
    }

    // 5차 검수 — 2차 근거를 받는 동안(실측 17.5초) 같은 일정의 이미 있는 일자가 편집됐다(TRIP-1000 · 재계획 반영·되돌리기도 같다).
    // 잠금 전 일자로 쓰면 그 편집이 조용히 되돌아간다. 잠금 뒤 일자 위에 2차 몫을 잇는다.
    "근거를 받는 동안 1일차가 바뀌었으면 마무리는 잠금 뒤 1일차 위에 잇는다 — 편집을 되돌리지 않는다" {
        val end = start.plusDays(1)
        val (agent, poiByDate) = emittingAgent(end)
        val partial = Itinerary.create(tripId, SolveMode.DETERMINISTIC, GenerationMode.FULLY_AI, false,
            listOf(ItineraryDay.of(start, 0, listOf(VisitSlot.of(UUID.randomUUID(), null, 0, LocalTime.parse("10:00"), LocalTime.parse("11:00"))))),
            now, GenerationState.PARTIAL,
        )
        val userPick = UUID.randomUUID()
        val editedMeanwhile = Itinerary.reconstitute(
            partial.itineraryId, partial.tripId, partial.status, partial.solveMode, partial.generationMode, partial.isFallback,
            GenerationState.PARTIAL, listOf(ItineraryDay.of(start, 0, listOf(VisitSlot.of(userPick, null, 0, LocalTime.parse("13:00"), LocalTime.parse("14:00"))))),
            partial.createdAt, now, partial.candidatesSummary, partial.unplacedMustVisits,
        )
        val repo = object : FakeItineraries() {
            override fun lockForTrip(tripId: UUID) = editedMeanwhile.also { byTrip[tripId] = it }
        }
        repo.byTrip[tripId] = partial

        SecondPhaseGenerator(agent, repo, genRevisions(repo, stubTrips), genSessions(), FakeScoredCandidatePoolStore(), NOOP_TX, clock)
            .completeRemaining(tripId, partial.itineraryId, agentInputFor(end), isRegeneration = false)

        val finished = repo.byTrip.getValue(tripId)
        finished.generationState shouldBe GenerationState.COMPLETE
        finished.days.first { it.date == start }.slots.single().sourcePoiId shouldBe userPick // 잠금 뒤 편집 보존
        finished.days.first { it.date == end }.slots.single().sourcePoiId shouldBe poiByDate.getValue(end) // 2차 몫
    }

    // 6차 검수 — 2차가 도는 사이 편집이 이미 있던 날 하나를 뺐다(PUT 으로 일자 삭제). 버리면 일정이 PARTIAL 로 영영 남고
    // 세션만 완료가 된다. 잠금 뒤 일자 뒤에 2차 몫을 이어 완료하고, 순서는 날짜순으로 다시 매긴다(빈 번호 없음).
    "2차 동안 편집이 날을 뺐으면 남은 날 뒤에 2차 몫을 이어 완료한다 — 순서는 다시 매기고 세션도 완료" {
        val end = start.plusDays(2)
        val (agent, poiByDate) = emittingAgent(end)
        val partial = Itinerary.create(tripId, SolveMode.DETERMINISTIC, GenerationMode.FULLY_AI, false,
            listOf(ItineraryDay.of(start, 0, emptyList()), ItineraryDay.of(start.plusDays(1), 1, emptyList())), now, GenerationState.PARTIAL,
        )
        val dropped = Itinerary.reconstitute(
            partial.itineraryId, partial.tripId, partial.status, partial.solveMode, partial.generationMode, partial.isFallback,
            GenerationState.PARTIAL, listOf(ItineraryDay.of(start, 0, emptyList())),
            partial.createdAt, now, partial.candidatesSummary, partial.unplacedMustVisits,
        )
        val repo = object : FakeItineraries() {
            override fun lockForTrip(tripId: UUID) = byTrip[tripId]?.takeIf { it.days.size == 1 } ?: dropped.also { byTrip[tripId] = it }
        }
        repo.byTrip[tripId] = partial
        val sessionRepo = FakeGenerationSessions()
        val session = sessionRepo.save(GenerationSession.start(acc, tripId, GenerationMode.FULLY_AI, now))

        SecondPhaseGenerator(agent, repo, genRevisions(repo, stubTrips), genSessions(repo = sessionRepo), FakeScoredCandidatePoolStore(), NOOP_TX, clock)
            .completeRemaining(tripId, partial.itineraryId, agentInputFor(end), isRegeneration = false, sessionId = session.sessionId)

        val finished = repo.byTrip.getValue(tripId)
        finished.generationState shouldBe GenerationState.COMPLETE
        finished.days.map { it.date } shouldContainExactly listOf(start, end)
        finished.days.map { it.dayOrder } shouldContainExactly listOf(0, 1)
        finished.days.single { it.date == end }.slots.single().sourcePoiId shouldBe poiByDate.getValue(end)
        sessionRepo.rows.getValue(session.sessionId).status shouldBe GenerationStatus.COMPLETED
    }

    // 방어 — 같은 일정의 쓰기는 날을 더하지 않아 겹칠 수 없다. 그래도 겹치면 조용히 버리지 않고 실패로 드러낸다(INV-4).
    "2차 몫과 같은 날이 잠금 뒤 일정에 있으면 FAILED 로 드러낸다 — 세션도 실패" {
        val end = start.plusDays(1)
        val (agent, _) = emittingAgent(end)
        val partial = Itinerary.create(tripId, SolveMode.DETERMINISTIC, GenerationMode.FULLY_AI, false,
            listOf(ItineraryDay.of(start, 0, emptyList())), now, GenerationState.PARTIAL,
        )
        val overlapping = Itinerary.reconstitute(
            partial.itineraryId, partial.tripId, partial.status, partial.solveMode, partial.generationMode, partial.isFallback,
            GenerationState.PARTIAL, listOf(ItineraryDay.of(start, 0, emptyList()), ItineraryDay.of(end, 1, emptyList())),
            partial.createdAt, now, partial.candidatesSummary, partial.unplacedMustVisits,
        )
        val repo = object : FakeItineraries() {
            override fun lockForTrip(tripId: UUID) = byTrip[tripId]?.takeIf { it.generationState != GenerationState.PARTIAL || it.days.size == 2 }
                ?: overlapping.also { byTrip[tripId] = it }
        }
        repo.byTrip[tripId] = partial
        val sessionRepo = FakeGenerationSessions()
        val session = sessionRepo.save(GenerationSession.start(acc, tripId, GenerationMode.FULLY_AI, now))

        SecondPhaseGenerator(agent, repo, genRevisions(repo, stubTrips), genSessions(repo = sessionRepo), FakeScoredCandidatePoolStore(), NOOP_TX, clock)
            .completeRemaining(tripId, partial.itineraryId, agentInputFor(end), isRegeneration = false, sessionId = session.sessionId)

        repo.byTrip.getValue(tripId).generationState shouldBe GenerationState.FAILED
        sessionRepo.rows.getValue(session.sessionId).status shouldBe GenerationStatus.FAILED
    }

    // 4차 검수 — 2차 마무리는 잠금 **뒤** 현행으로 판정한다. 잠금 전에 읽은 값(PARTIAL)으로 정하면, 그 사이 끝난 편집(COMPLETE)
    // 위에 2차를 얹어 편집을 덮는다.
    "2차 마무리는 잠금 뒤 일정으로 판정한다 — 그 사이 편집이 끝났으면 버린다" {
        val end = start.plusDays(1)
        val (agent, _) = emittingAgent(end)
        val partial = Itinerary.create(tripId, SolveMode.DETERMINISTIC, GenerationMode.FULLY_AI, false,
            listOf(ItineraryDay.of(start, 0, emptyList())), now, GenerationState.PARTIAL,
        )
        val editedMeanwhile = Itinerary.reconstitute(
            partial.itineraryId, partial.tripId, partial.status, partial.solveMode, partial.generationMode, partial.isFallback,
            GenerationState.COMPLETE, partial.days, partial.createdAt, now, partial.candidatesSummary, partial.unplacedMustVisits,
        )
        val repo = object : FakeItineraries() {
            override fun lockForTrip(tripId: UUID) = editedMeanwhile
        }
        repo.byTrip[tripId] = partial

        SecondPhaseGenerator(agent, repo, genRevisions(repo, stubTrips), genSessions(), FakeScoredCandidatePoolStore(), NOOP_TX, clock)
            .completeRemaining(tripId, partial.itineraryId, agentInputFor(end), isRegeneration = false)

        repo.byTrip.getValue(tripId) shouldBe partial // 잠금 뒤 판정이 버렸다 — 잠금 전 PARTIAL 위에 얹지 않았다
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
        SecondPhaseGenerator(agent, repo, genRevisions(repo, stubTrips), genSessions(), FakeScoredCandidatePoolStore(), NOOP_TX, clock)
            .completeRemaining(tripId, edited.itineraryId, agentInputFor(end), isRegeneration = false)

        repo.byTrip.getValue(tripId) shouldBe edited // 그대로
    }

    "2차 결과는 이어붙일 뿐이다 — 생성 중에 반영된 1일차 편집을 덮어쓰지 않는다(TRIP-1000)" {
        // PARTIAL 편집이 열리면서(이미 만들어진 일자 한정) 이 보장이 계약이 됐다 — 병합이
        // 트랜잭션 안에서 최신 상태를 다시 읽어 그 위에 나머지 일자만 얹는지를 잠근다.
        val end = start.plusDays(1)
        val userPick = UUID.randomUUID() // 사용자가 2차 도는 사이 1일차에 넣은 장소
        val (agent, poiByDate) = emittingAgent(end)
        val repo = FakeItineraries()
        val editedDay1 = Itinerary.create(tripId, SolveMode.DETERMINISTIC, GenerationMode.FULLY_AI, false,
            listOf(ItineraryDay.of(start, 0, listOf(VisitSlot.of(userPick, null, 0, LocalTime.parse("10:00"), LocalTime.parse("11:00"))))),
            now, GenerationState.PARTIAL,
        )
        repo.byTrip[tripId] = editedDay1

        SecondPhaseGenerator(agent, repo, genRevisions(repo, stubTrips), genSessions(), FakeScoredCandidatePoolStore(), NOOP_TX, clock)
            .completeRemaining(tripId, editedDay1.itineraryId, agentInputFor(end), isRegeneration = false)

        val finished = repo.byTrip.getValue(tripId)
        finished.generationState shouldBe GenerationState.COMPLETE
        finished.days.first { it.date == start }.slots.single().sourcePoiId shouldBe userPick // 편집 보존
        finished.days.first { it.date == end }.slots.single().sourcePoiId shouldBe poiByDate.getValue(end) // 2차 몫
    }

    "2차 폴백의 물질화 슬롯은 '변경 불가'가 아니다 — 시각이 없는 블록은 사용자 고정이 아니다(TRIP-1001 · QA #049)" {
        val end = start.plusDays(1)
        val materializedPoi = UUID.randomUUID()
        val agent = object : StubScheduleAgent() {
            override fun generate(input: ScheduleAgentInput): ScheduleAgentOutput =
                throw ScheduleAgentCallFailed("AI_ERROR", retryable = false, message = "조립 실패 재현")
            override fun explanations(tripId: UUID, solution: ScheduleAgentOutput, preference: PreferenceProfile?, companionType: String?) = SlotExplanations()
        }
        val repo = FakeItineraries()
        val partial = Itinerary.create(tripId, SolveMode.FULL_AI, GenerationMode.FULLY_AI, false,
            listOf(ItineraryDay.of(start, 0, emptyList())), now, GenerationState.PARTIAL,
        )
        repo.byTrip[tripId] = partial
        val input = agentInputFor(end).copy(
            // 물질화된 ANYTIME 의 실제 모양 — 날짜만 있고 시각은 비어 있다(TRIP-1249).
            fixedBlocks = listOf(FixedBlock(materializedPoi, end, null, 60)),
        )

        SecondPhaseGenerator(agent, repo, genRevisions(repo, stubTrips), genSessions(), FakeScoredCandidatePoolStore(), NOOP_TX, clock)
            .completeRemaining(tripId, partial.itineraryId, input, isRegeneration = false)

        val slot = repo.byTrip.getValue(tripId).days.first { it.date == end }.slots.single()
        slot.sourcePoiId shouldBe materializedPoi
        slot.isFixed shouldBe false // 사용자가 고정하지 않았다 — 폴백 화면의 "변경 불가"는 거짓이었다
    }

    // ── 취향 점수 신호(TRIP-1173) — 안 실으면 응답 직후엔 보여도 재조회에서 늘 "모름"이 된다 ──

    "LLM 점수에 실패한 생성은 저장된 일정에 RULE 과 llm: 코드가 남는다(1차·2차 모두)" {
        val rule = ScoringSignal(ScoringMode.RULE, listOf("llm:c1_fallback"))
        val repo = FakeItineraries()
        val returned = service(ScoringAgent(now, listOf(rule, rule)), repo, start.plusDays(2)).generate(acc, tripId, GenerationMode.FULLY_AI)

        returned.scoring shouldBe rule // 201 본문(PARTIAL)
        val saved = repo.byTrip.getValue(tripId)
        saved.generationState shouldBe GenerationState.COMPLETE
        saved.scoring shouldBe rule
    }

    "정상 LLM 점수면 LLM — 1차만 있는 하루 여행도 그 값이 최종이다" {
        val llm = ScoringSignal(ScoringMode.LLM, emptyList())
        val repo = FakeItineraries()
        service(ScoringAgent(now, listOf(llm)), repo, start).generate(acc, tripId, GenerationMode.FULLY_AI)

        repo.byTrip.getValue(tripId).scoring shouldBe llm
    }

    fun partialWith(scoring: ScoringSignal): Itinerary = Itinerary.create(
        tripId, SolveMode.FULL_AI, GenerationMode.FULLY_AI, false,
        listOf(ItineraryDay.of(start, 0, emptyList())), now, GenerationState.PARTIAL, scoring = scoring,
    )

    "2차가 실패해 최소 폴백이 되면 1차의 LLM 이 남지 않는다 — 모름으로 저하를 드러낸다(INV-4)" {
        val repo = FakeItineraries()
        val partial = partialWith(ScoringSignal(ScoringMode.LLM, listOf("weather:weather_error")))
        repo.byTrip[tripId] = partial

        SecondPhaseGenerator(ScoringAgent(now, listOf(null)), repo, genRevisions(repo, stubTrips), genSessions(), FakeScoredCandidatePoolStore(), NOOP_TX, clock)
            .completeRemaining(tripId, partial.itineraryId, agentInputFor(start.plusDays(1)), isRegeneration = false)

        repo.byTrip.getValue(tripId).scoring shouldBe ScoringSignal(null, listOf("weather:weather_error"))
    }

    "2차가 맡은 날이 모두 닫혀 AI 를 안 불렀으면 1차 신호가 그대로 최종이다 — 안 부른 자리의 모름을 섞지 않는다" {
        val repo = FakeItineraries()
        val first = ScoringSignal(ScoringMode.LLM, emptyList())
        val partial = partialWith(first)
        repo.byTrip[tripId] = partial
        val agent = ScoringAgent(now, emptyList()) // 불리면 IndexOutOfBounds — 안 불려야 한다

        SecondPhaseGenerator(agent, repo, genRevisions(repo, stubTrips), genSessions(), FakeScoredCandidatePoolStore(), NOOP_TX, clock)
            .completeRemaining(tripId, partial.itineraryId, agentInputFor(start.plusDays(1)).copy(timeWindows = emptyList()), isRegeneration = false)

        val saved = repo.byTrip.getValue(tripId)
        saved.generationState shouldBe GenerationState.COMPLETE
        saved.scoring shouldBe first
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
        SecondPhaseGenerator(agent, repo, genRevisions(repo, stubTrips), genSessions(), FakeScoredCandidatePoolStore(), NOOP_TX, clock)
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
                override fun explanations(tripId: UUID, solution: ScheduleAgentOutput, preference: PreferenceProfile?, companionType: String?): SlotExplanations = SlotExplanations()
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
        SecondPhaseGenerator(agent, repo, genRevisions(repo, stubTrips), genSessions(), FakeScoredCandidatePoolStore(), NOOP_TX, clock).completeRemaining(tripId, partial.itineraryId, agentInputFor(end), isRegeneration = false)

        val finished = repo.byTrip.getValue(tripId)
        finished.generationState shouldBe GenerationState.FAILED
        finished.days.map { it.date } shouldContainExactly listOf(start) // 1차분 보존
    }

    // TRIP-1412 4차 검수 — 실패 표시도 일정 쓰기 잠금 뒤 현행으로 판정한다. 잠금 전 값으로 정하면 그 사이 끝난 편집(COMPLETE)을 FAILED 로 덮는다.
    "2차 실패 표시는 잠금 뒤 일정으로 판정한다 — 그 사이 끝났으면 FAILED 로 덮지 않는다" {
        val end = start.plusDays(2)
        val (agent, _) = emittingAgent(end)
        val partial = Itinerary.create(tripId, SolveMode.FULL_AI, GenerationMode.FULLY_AI, false,
            listOf(ItineraryDay.of(start, 0, emptyList())), now, GenerationState.PARTIAL,
        )
        val doneMeanwhile = Itinerary.reconstitute(
            partial.itineraryId, partial.tripId, partial.status, partial.solveMode, partial.generationMode, partial.isFallback,
            GenerationState.COMPLETE, partial.days, partial.createdAt, now, partial.candidatesSummary, partial.unplacedMustVisits,
        )
        var locks = 0
        val repo = object : FakeItineraries() {
            override fun replaceForTrip(tripId: UUID, itinerary: Itinerary): Itinerary {
                if (itinerary.generationState == GenerationState.COMPLETE) throw RuntimeException("db down")
                return super.replaceForTrip(tripId, itinerary)
            }
            // 첫 잠금(완료 반영)은 PARTIAL, 둘째 잠금(실패 표시)에서는 그 사이 끝난 일정이 보인다.
            override fun lockForTrip(tripId: UUID) = if (++locks == 1) findByTrip(tripId).firstOrNull() else doneMeanwhile
        }
        repo.byTrip[tripId] = partial
        SecondPhaseGenerator(agent, repo, genRevisions(repo, stubTrips), genSessions(), FakeScoredCandidatePoolStore(), NOOP_TX, clock).completeRemaining(tripId, partial.itineraryId, agentInputFor(end), isRegeneration = false)

        locks shouldBe 2
        repo.byTrip.getValue(tripId).generationState shouldBe GenerationState.PARTIAL // FAILED 로 덮지 않았다
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
            override fun explanations(tripId: UUID, solution: ScheduleAgentOutput, preference: PreferenceProfile?, companionType: String?): SlotExplanations = SlotExplanations()
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
                    TripGenerationContext(start, end, refs("제주"), "친구", 500_000, emptyList())
            }
            val preferences = object : PreferenceFacade {
                override fun findPreferences(accountId: UUID) = prefs
            }
            val baseAnchors = object : BaseAnchorFacade {
                override fun findStayNightAnchors(tripId: UUID, startDate: LocalDate, endDate: LocalDate) = emptyList<DayAnchorView>()
            }
            val second = SecondPhaseGenerator(agent, repo, genRevisions(repo, trips), genSessions(), FakeScoredCandidatePoolStore(), NOOP_TX, clock)
            GenerateItineraryService(trips, preferences, baseAnchors, agent, repo, CapturingPublisher(), second, genSessions(), genRevisions(repo, trips), StubRegions, FakeRejectionStore(), FakeScoredCandidatePoolStore(), NoPersonalization, NoVisits, NOOP_TX, clock, defaultDeadlines)
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
/**
 * 개인화 없음(TRIP-556). 기본값이 **아무것도 보태지 않는 것**이라, 대부분의 생성 테스트는 이걸 쓴다 —
 * 동의·기록에 따른 분기는 `PersonalizationMergeTest` 가 따로 본다.
 */
private object NoPersonalization : PersonalizationPort {
    override fun hintsFor(accountId: java.util.UUID) = PersonalizationHints.NONE
}

/** 다녀온 기록 없음 — 생성 테스트 대부분의 전제. 기록이 있을 때의 재생성 가드는 [Visited] 로 본다. */
private val NoVisits = VisitRecordPort { false }
private val Visited = VisitRecordPort { true }

private object StubRegions : com.trippilot.placedata.api.RegionLookupFacade {
    /** 코드 검증 — 이 테스트는 이름 경로만 쓴다. */
    override fun isSelectableCode(regionCode: String) = false

    override fun codesOf(regionName: String): List<String> = emptyList()
    override fun centerOf(regionName: String) = when (regionName) {
        "좌표없는곳" -> null
        "서울" -> SEOUL
        "인천" -> INCHEON
        else -> com.trippilot.placedata.api.RegionCenter(33.4996, 126.5312)
    }

    /** 코드 중심 — 이 대역은 코드를 이름처럼 다룬다. 코드 우선 경로는 `RegionCodeAnchorTest` 가 본다. */
    override fun centerOfCode(regionCode: String) = centerOf(regionCode)
}

private val SEOUL = com.trippilot.placedata.api.RegionCenter(37.5665, 126.9780)
private val INCHEON = com.trippilot.placedata.api.RegionCenter(37.4563, 126.7052)

/** 코드 없는 목적지 — 기존 테스트는 전부 이름 경로다(코드 경로는 `RegionCodeAnchorTest`). */
private fun refs(vararg names: String) = names.map { TripDestinationRef(it, null, 0) }
