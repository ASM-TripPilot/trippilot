package com.trippilot.itinerarygeneration.application

import com.trippilot.core.error.ConflictDetected
import com.trippilot.itinerarygeneration.api.ReplanCommand
import com.trippilot.itinerarygeneration.api.ReplanProposal
import com.trippilot.itinerarygeneration.api.ReplanSlot
import com.trippilot.itinerarygeneration.domain.DaySchedule
import com.trippilot.itinerarygeneration.domain.FreshnessMeta
import com.trippilot.itinerarygeneration.domain.GenerationMode
import com.trippilot.itinerarygeneration.domain.GenerationState
import com.trippilot.itinerarygeneration.domain.Itinerary
import com.trippilot.itinerarygeneration.domain.ItineraryDay
import com.trippilot.itinerarygeneration.domain.ItineraryRepository
import com.trippilot.savedaccommodation.api.BaseAnchorFacade
import com.trippilot.trip.api.TripFacade
import com.trippilot.trip.api.TripGenerationContext
import com.trippilot.trip.api.TripPeriod
import com.trippilot.savedaccommodation.api.DayAnchorView
import com.trippilot.itinerarygeneration.domain.ReplanInput
import com.trippilot.itinerarygeneration.domain.ScheduleAgentOutput
import com.trippilot.itinerarygeneration.domain.SolveMode
import com.trippilot.itinerarygeneration.domain.VisitSlot
import com.trippilot.itinerarygeneration.domain.VisitSlotDisplay
import io.kotest.assertions.throwables.shouldThrow
import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.collections.shouldContainExactly
import io.kotest.matchers.nulls.shouldBeNull
import io.kotest.matchers.shouldBe
import java.time.Clock
import java.time.Instant
import java.time.LocalDate
import java.time.LocalTime
import java.time.ZoneOffset
import java.util.UUID

/** 이 파일 전용 대역 — 같은 패키지의 다른 테스트와 이름이 겹치면 Redeclaration 이다(anti-patterns.md). */
private class ReplanItineraries : ItineraryRepository {
    val byTrip = mutableMapOf<UUID, Itinerary>()
    override fun save(itinerary: Itinerary) = itinerary.also { byTrip[it.tripId] = it }
    override fun findById(itineraryId: UUID) = byTrip.values.firstOrNull { it.itineraryId == itineraryId }
    override fun findByTrip(tripId: UUID) = listOfNotNull(byTrip[tripId])
    override fun replaceForTrip(tripId: UUID, itinerary: Itinerary) = itinerary.also { byTrip[tripId] = it }
    override fun replaceIfCurrent(tripId: UUID, expectedItineraryId: UUID, itinerary: Itinerary): Boolean {
        val current = byTrip[tripId] ?: return false
        if (current.itineraryId != expectedItineraryId) return false
        byTrip[tripId] = itinerary
        return true
    }
    override fun findStalePartial(updatedBefore: Instant): List<Itinerary> = emptyList()
}

/**
 * 재계획 산출·반영(C8 · U4 정본 §3.1 · INV-U4-04·05).
 *
 * 여기서만 드러나는 것 — **잠금 계산**이다. 완료·시각 고정·지나간 슬롯을 잠그지 않으면 다시 짤 때
 * 이미 다녀온 곳이 사라지거나 예약 시각이 밀린다. 잠금 규칙은 슬롯 시각을 아는 이 모듈에만 있다.
 */
class ReplanFacadeServiceTest : StringSpec({

    val acc = UUID.randomUUID()
    val trip = UUID.randomUUID()
    val today = LocalDate.parse("2026-08-11")
    // KST 15:00 — 오전 슬롯은 지나갔고 오후는 남았다.
    val clock = Clock.fixed(Instant.parse("2026-08-11T06:00:00Z"), ZoneOffset.UTC)
    val now = clock.instant()

    val morning = UUID.randomUUID()
    val fixedNoon = UUID.randomUUID()
    val evening = UUID.randomUUID()
    val replacement = UUID.randomUUID()

    fun slot(poi: UUID, start: String, end: String, isFixed: Boolean = false, order: Int = 0) =
        VisitSlot.of(poi, null, order, LocalTime.parse(start), LocalTime.parse(end), isFixed = isFixed)

    fun itinerary() = Itinerary.create(
        trip, SolveMode.FULL_AI, GenerationMode.FULLY_AI, false,
        listOf(
            ItineraryDay.of(
                today, 0,
                listOf(
                    slot(morning, "09:00", "10:00", order = 0),
                    slot(fixedNoon, "12:00", "13:30", isFixed = true, order = 1),
                    slot(evening, "18:00", "19:00", order = 2),
                ),
            ),
            ItineraryDay.of(today.plusDays(1), 1, listOf(slot(UUID.randomUUID(), "10:00", "11:00"))),
        ),
        now, GenerationState.COMPLETE,
    )

    class Agent(val days: List<DaySchedule>) : StubScheduleAgent() {
        val inputs = mutableListOf<ReplanInput>()
        override fun replan(input: ReplanInput): ScheduleAgentOutput {
            inputs += input
            return ScheduleAgentOutput(
                days = days, day1ReadyAt = null, explanations = emptyMap(),
                solveMode = SolveMode.DETERMINISTIC, isFallback = false,
                freshness = FreshnessMeta(Instant.parse("2026-08-11T06:00:00Z"), degraded = false),
            )
        }
    }

    fun proposal(vararg pois: UUID) = listOf(
        DaySchedule(today, pois.map { VisitSlotDisplay(it, LocalTime.parse("16:00"), LocalTime.parse("17:00"), false, null, false) }),
    )

    // 목적지가 있어야 재계획을 보낼 수 있다 — 빈 목록은 상대가 422 로 거부한다(실측).
    val replanTrips = object : TripFacade {
        override fun findPeriod(accountId: UUID, tripId: UUID) = TripPeriod(today, today.plusDays(1))
        override fun findGenerationContext(accountId: UUID, tripId: UUID) =
            TripGenerationContext(today, today.plusDays(1), listOf("제주"), "친구", 500_000, emptyList())
    }

    // 재계획 기준점은 테스트에서 항상 현재 위치로 채운다 — 앵커 사다리까지 안 내려간다.
    val noAnchors = object : BaseAnchorFacade {
        override fun findStayNightAnchors(tripId: UUID, startDate: LocalDate, endDate: LocalDate) = emptyList<DayAnchorView>()
    }

    /** 리비전 서비스를 **한 번만** 만들어 공유한다 — 다시 만들면 다른 저장소를 보게 되어 비교가 어긋난다. */
    class Fx(val svc: ReplanFacadeService, val repo: ReplanItineraries, val revisions: ItineraryRevisionService)

    fun fixture(agent: Agent, repo: ReplanItineraries = ReplanItineraries()): Fx {
        repo.byTrip[trip] = itinerary()
        val revisions = genRevisions(repo, replanTrips, clock)
        return Fx(ReplanFacadeService(replanTrips, repo, agent, noAnchors, revisions, clock), repo, revisions)
    }

    fun command(fullDay: Boolean = false, completed: List<String> = emptyList()) = ReplanCommand(
        accountId = acc, tripId = trip, targetDate = today, fromInstant = now, fullDay = fullDay,
        completedSlotKeys = completed, originLat = 33.45, originLng = 126.56,
        reasons = listOf("비가 와요"), directives = listOf("실내로"), freeText = null, excludedPoiIds = emptyList(),
    )

    "지금 이후만 다시 짤 때 — 지나간 슬롯과 시각 고정이 잠긴다" {
        val agent = Agent(proposal(replacement))
        val svc = fixture(agent).svc

        svc.propose(command(fullDay = false))

        // 09:00 은 지나갔고 12:00 은 고정 — 18:00 만 다시 짤 대상이다.
        // 시각을 함께 실어야 상대가 받는다(계약 M1) — 키만 보내면 422 다.
        agent.inputs.single().lockedBlocks.map { it.poiId to it.start } shouldContainExactly
            listOf(morning to LocalTime.parse("09:00"), fixedNoon to LocalTime.parse("12:00"))
    }

    "오늘 전체를 다시 짤 때 — 시각 고정만 잠긴다(지나간 것은 푼다)" {
        val agent = Agent(proposal(replacement))
        val svc = fixture(agent).svc

        svc.propose(command(fullDay = true))

        agent.inputs.single().lockedBlocks.map { it.poiId } shouldContainExactly listOf(fixedNoon)
    }

    // 완료 실적은 C10 만 안다 — 전달이 끊기면 이미 다녀온 곳이 재계획에서 사라진다.
    "완료 실적으로 받은 슬롯도 함께 잠긴다" {
        val agent = Agent(proposal(replacement))
        val svc = fixture(agent).svc

        svc.propose(command(fullDay = true, completed = listOf("$today#$evening")))

        agent.inputs.single().lockedBlocks.map { it.poiId } shouldContainExactly listOf(fixedNoon, evening)
    }

    "산출은 일정에 손대지 않는다(INV-U4-05)" {
        val agent = Agent(proposal(replacement))
        val f = fixture(agent)
        val svc = f.svc
        val repo = f.repo
        val before = repo.byTrip.getValue(trip)

        svc.propose(command())

        repo.byTrip.getValue(trip) shouldBe before
    }

    "대안이 없으면 null — 빈 초안을 만들지 않는다" {
        val agent = Agent(listOf(DaySchedule(today, emptyList())))
        val svc = fixture(agent).svc

        svc.propose(command()).shouldBeNull()
    }

    "확정하면 대상 일자만 교체되고 다른 날은 그대로다" {
        val agent = Agent(proposal(replacement))
        val f = fixture(agent)
        val svc = f.svc
        val repo = f.repo
        val secondDayBefore = repo.byTrip.getValue(trip).days[1]
        val proposal = svc.propose(command())!!

        svc.apply(acc, trip, proposal)

        val after = repo.byTrip.getValue(trip)
        after.days[0].slots.map { it.sourcePoiId } shouldContainExactly listOf(replacement)
        after.days[1] shouldBe secondDayBefore
    }

    // 반영 전에 되돌릴 지점이 없으면 "재계획 전으로" 돌아갈 수 없다(BR-U3-19).
    "확정 전에 되돌릴 지점을 남긴다" {
        val agent = Agent(proposal(replacement))
        val f = fixture(agent)
        val proposal = f.svc.propose(command())!!

        f.svc.apply(acc, trip, proposal)

        f.revisions.list(acc, trip, limit = 10).size shouldBe 2 // 되돌리기 지점 + 재계획 반영
    }

    "그 사이 일정이 교체됐으면 반영하지 않는다 — 방금 만든 일정이 사라진다" {
        val agent = Agent(proposal(replacement))
        val f = fixture(agent)
        val svc = f.svc
        val repo = f.repo
        val proposal = svc.propose(command())!!
        repo.byTrip[trip] = itinerary() // 재생성으로 새 itineraryId

        shouldThrow<ConflictDetected> { svc.apply(acc, trip, proposal) }
    }

    "확정된 일정에는 반영하지 않는다" {
        val agent = Agent(proposal(replacement))
        val f = fixture(agent)
        val svc = f.svc
        val repo = f.repo
        val proposal = svc.propose(command())!!
        repo.byTrip[trip] = repo.byTrip.getValue(trip).confirm(now)

        shouldThrow<ConflictDetected> { svc.apply(acc, trip, proposal) }
    }

    "초안 왕복이 항등이다 — 저장했다 돌아와도 값이 새지 않는다" {
        val original = ReplanProposal(
            UUID.randomUUID(), today,
            listOf(
                ReplanSlot(replacement, LocalTime.parse("16:00"), LocalTime.parse("17:00"), false, false, "약 1.2km", "실내라 비를 피해요"),
                ReplanSlot(evening, LocalTime.parse("23:00"), LocalTime.parse("01:00"), true, true, null, null),
            ),
        )

        ReplanProposal.fromMap(original.toMap()) shouldBe original
    }

    /**
     * 상대가 **다른 날짜**를 돌려줬을 때. 그 슬롯을 오늘 것처럼 초안에 담으면, 확정 순간 오늘 일정이
     * 엉뚱한 날의 계획으로 덮인다. 생성 경로에는 같은 상황의 가드가 이미 있다(일자 중복 방지).
     */
    "요청한 날짜가 응답에 없으면 대안 없음이다 — 다른 날 계획을 오늘로 옮기지 않는다" {
        val other = today.plusDays(1)
        val agent = Agent(listOf(DaySchedule(other, listOf(
            VisitSlotDisplay(replacement, LocalTime.parse("16:00"), LocalTime.parse("17:00"), false, null, false),
        ))))
        val svc = fixture(agent).svc

        svc.propose(command()).shouldBeNull()
    }

    /**
     * 초안의 날짜가 일정에 없을 때. 조용히 통과시키면 **아무것도 안 바뀌었는데** "재계획 반영" 리비전만
     * 쌓이고, 사용자는 반영됐다고 믿는다.
     */
    "초안 날짜가 일정에 없으면 반영하지 않는다" {
        val agent = Agent(proposal(replacement))
        val f = fixture(agent)
        val proposal = f.svc.propose(command())!!
        val strayDate = proposal.copy(date = today.plusDays(5))

        shouldThrow<ConflictDetected> { f.svc.apply(acc, trip, strayDate) }
        f.repo.byTrip.getValue(trip).days[0].slots.map { it.sourcePoiId } shouldContainExactly
            listOf(morning, fixedNoon, evening) // 원본 그대로
    }
})
