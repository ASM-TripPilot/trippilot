package com.trippilot.itinerarygeneration.application

import com.trippilot.itinerarygeneration.domain.DaySchedule
import com.trippilot.itinerarygeneration.domain.FreshnessMeta
import com.trippilot.itinerarygeneration.domain.GenerationState
import com.trippilot.itinerarygeneration.domain.GenerationMode
import com.trippilot.itinerarygeneration.domain.Itinerary
import com.trippilot.itinerarygeneration.domain.NewRevision
import com.trippilot.itinerarygeneration.domain.ItineraryRevisionRepository
import com.trippilot.itinerarygeneration.domain.ItineraryRevision
import com.trippilot.itinerarygeneration.domain.ItineraryRevisionSummary
import com.trippilot.itinerarygeneration.domain.ItineraryRepository
import com.trippilot.itinerarygeneration.domain.RepairResult
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
import io.kotest.core.spec.style.StringSpec
import io.kotest.property.Arb
import io.kotest.property.arbitrary.int
import io.kotest.property.checkAll
import io.kotest.matchers.collections.shouldContainExactly
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
}

/** ScheduleAgent(AI) 실패 재현 — INV-4 폴백 경로 검증용. */
private class ThrowingAgent : StubScheduleAgent() {
    override fun generate(input: ScheduleAgentInput): ScheduleAgentOutput = throw RuntimeException("agent down")
    override fun validate(solution: ScheduleAgentOutput): List<Violation> = emptyList()
    override fun repair(solution: ScheduleAgentOutput, violations: List<Violation>) = RepairResult(solution, emptyList())
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

internal fun genRevisions(repo: ItineraryRepository, trips: TripFacade, clock: Clock = Clock.fixed(Instant.parse("2026-08-06T00:00:00Z"), ZoneOffset.UTC)) =
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

    val now = Instant.parse("2026-08-06T00:00:00Z")
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
        end: LocalDate = defaultEnd,
        fixedVisits: List<FixedVisit> = listOf(FixedVisit(poi, start, LocalTime.parse("12:00"), 90)),
    ): GenerateItineraryService {
        val trips = object : TripFacade {
            override fun findPeriod(accountId: UUID, tripId: UUID) = TripPeriod(start, end)
            @Suppress("UNUSED_PARAMETER")
            override fun findGenerationContext(accountId: UUID, tripId: UUID) =
                if (accountId == acc) {
                    TripGenerationContext(
                        start, end, listOf("제주"), "친구", 500_000, fixedVisits,
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
        val second = SecondPhaseGenerator(agent, repo, genRevisions(repo, trips), NOOP_TX, clock)
        return GenerateItineraryService(trips, preferences, baseAnchors, agent, repo, publisher, second, genRevisions(repo, trips), NOOP_TX, clock)
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

    "ANYTIME 은 아직 물질화되지 않은 채 경계로 나간다 (M1 — 구현되면 이 테스트를 뒤집을 것)" {
        // 알려진 간극. 실 AI 는 이 모양이면 **요청 전체를 422 로 거부**하고(그쪽 api/wiring.py),
        // Fake 는 date != null 만 그룹핑해 조용히 버린다. 어느 쪽도 결과만 보고는 이유를 알 수 없다.
        val anytime = UUID.randomUUID()
        val agent = CapturingAgent(now)
        service(agent, fullPrefs, emptyList(), fixedVisits = listOf(FixedVisit(anytime, null, null, null)))
            .generate(acc, tripId, GenerationMode.FULLY_AI)

        val block = agent.captures[1].fixedBlocks.single { it.poiId == anytime }
        // 물질화가 들어오면 date·start 가 채워져 아래 두 줄이 깨진다 — 그때 값이 있음을 단언하도록 바꾼다.
        block.date shouldBe null
        block.start shouldBe null
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
        agent.captured!!.anchors shouldBe emptyList()
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
})

/** day1 조기 노출 2단계(TRIP-267) — 1차 즉시 반환(PARTIAL) · 2차 백그라운드 완료(COMPLETE). */
class GenerateItineraryTwoPhaseTest : StringSpec({

    val now = Instant.parse("2026-08-06T00:00:00Z")
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

    fun service(agent: ScheduleAgentPort, repo: FakeItineraries, end: LocalDate): GenerateItineraryService {
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
        val second = SecondPhaseGenerator(agent, repo, genRevisions(repo, trips), NOOP_TX, clock)
        return GenerateItineraryService(trips, preferences, baseAnchors, agent, repo, CapturingPublisher(), second, genRevisions(repo, trips), NOOP_TX, clock)
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
                explanations = poiByDate.entries.associate { (d, p) -> "$d#$p" to "$d 근거" },
                solveMode = SolveMode.DETERMINISTIC, isFallback = false,
                freshness = FreshnessMeta(now, degraded = false),
            )
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

    "1차 시한은 day1 예산(5s), 2차는 전체 예산(20s)" {
        val end = start.plusDays(2)
        val (agent, _) = emittingAgent(end)
        service(agent, FakeItineraries(), end).generate(acc, tripId, GenerationMode.FULLY_AI)

        agent.captures[0].requestMeta.deadlineMs shouldBe 5_000L
        agent.captures[1].requestMeta.deadlineMs shouldBe 20_000L
    }

    "단일일 여행: 2차 없이 바로 COMPLETE" {
        val (agent, _) = emittingAgent(start)
        val returned = service(agent, FakeItineraries(), start).generate(acc, tripId, GenerationMode.FULLY_AI)

        returned.generationState shouldBe GenerationState.COMPLETE
        agent.captures.size shouldBe 1 // 2차 호출 없음
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
        SecondPhaseGenerator(agent, repo, genRevisions(repo, stubTrips), NOOP_TX, clock)
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
        SecondPhaseGenerator(agent, repo, genRevisions(repo, stubTrips), NOOP_TX, clock)
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
        SecondPhaseGenerator(agent, repo, genRevisions(repo, stubTrips), NOOP_TX, clock).completeRemaining(tripId, partial.itineraryId, agentInputFor(end), isRegeneration = false)

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

    val now = Instant.parse("2026-08-06T00:00:00Z")
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
            val second = SecondPhaseGenerator(agent, repo, genRevisions(repo, trips), NOOP_TX, clock)
            GenerateItineraryService(trips, preferences, baseAnchors, agent, repo, CapturingPublisher(), second, genRevisions(repo, trips), NOOP_TX, clock)
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
