package com.trippilot.itinerarygeneration.application

import com.trippilot.core.error.ResourceNotFound
import com.trippilot.core.error.ValidationFailed
import com.trippilot.itinerarygeneration.api.EditProposal
import com.trippilot.itinerarygeneration.api.EditProposalRequest
import com.trippilot.itinerarygeneration.api.ProposalViolation
import com.trippilot.itinerarygeneration.domain.DaySchedule
import com.trippilot.itinerarygeneration.domain.EditCommand
import com.trippilot.itinerarygeneration.domain.EditProposalInput
import com.trippilot.itinerarygeneration.domain.EditProposalOutput
import com.trippilot.itinerarygeneration.domain.EditProposalStatus
import com.trippilot.itinerarygeneration.domain.GenerationMode
import com.trippilot.itinerarygeneration.domain.Itinerary
import com.trippilot.itinerarygeneration.domain.ItineraryDay
import com.trippilot.itinerarygeneration.domain.ItineraryRepository
import com.trippilot.itinerarygeneration.domain.ScheduleAgentCallFailed
import com.trippilot.itinerarygeneration.domain.SolveMode
import com.trippilot.itinerarygeneration.domain.Violation
import com.trippilot.itinerarygeneration.domain.VisitSlot
import com.trippilot.itinerarygeneration.domain.VisitSlotDisplay
import com.trippilot.placedata.api.RegionCenter
import com.trippilot.placedata.api.RegionLookupFacade
import com.trippilot.profile.api.PreferenceFacade
import com.trippilot.profile.api.PreferenceSnapshot
import com.trippilot.savedaccommodation.api.BaseAnchorFacade
import com.trippilot.savedaccommodation.api.DayAnchorView
import com.trippilot.trip.api.TripFacade
import com.trippilot.trip.api.TripGenerationContext
import com.trippilot.trip.api.TripPeriod
import io.kotest.assertions.throwables.shouldThrow
import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.collections.shouldContainExactly
import io.kotest.matchers.shouldBe
import io.kotest.matchers.types.shouldBeInstanceOf
import java.time.Clock
import java.time.Instant
import java.time.LocalDate
import java.time.LocalTime
import java.time.ZoneOffset
import java.util.UUID

/**
 * 편집 제안 퍼사드(U8 G-U8-2). 도우미 모듈이 보는 것은 이 계약뿐이라 **실물이 맞는지는 여기서만 확인된다.**
 *
 * 지키려는 것은 둘이다 — 어떤 경로로도 **저장하지 않는다**(BR-U8-30), 그리고 상대가 죽거나 늦어도
 * 예외나 일정 폴백이 아니라 "지금은 제안할 수 없다"로 돌아온다(대화 턴이 500 으로 끝나지 않게).
 */
class EditProposalServiceTest : StringSpec({

    val acc = UUID.randomUUID()
    val tripId = UUID.randomUUID()
    val d1 = LocalDate.parse("2026-08-10")
    val d2 = LocalDate.parse("2026-08-11")
    val (a, b, c, fresh) = List(4) { UUID.randomUUID() }
    val now = Instant.parse("2026-08-01T00:00:00Z")
    val clock = Clock.fixed(now, ZoneOffset.UTC)

    fun slot(poi: UUID, order: Int, start: String, fixed: Boolean = false) =
        VisitSlot.of(poi, null, order, LocalTime.parse(start), LocalTime.parse(start).plusHours(1), fixed, distanceRange = "약 1km")

    val stored = Itinerary.create(
        tripId, SolveMode.FULL_AI, GenerationMode.FULLY_AI, false,
        listOf(
            ItineraryDay.of(d1, 0, listOf(slot(a, 0, "09:00"), slot(b, 1, "11:00", fixed = true))),
            ItineraryDay.of(d2, 1, listOf(slot(c, 0, "10:00"))),
        ),
        now,
    )

    /** 쓰기를 세는 저장소 — 제안은 어떤 결과에서도 0 이어야 한다. */
    class CountingRepo(private val held: Itinerary?) : ItineraryRepository {
        var writes = 0
        override fun save(itinerary: Itinerary) = itinerary.also { writes++ }
        override fun findById(itineraryId: UUID) = held
        override fun findByTrip(tripId: UUID) = listOfNotNull(held)
        override fun replaceForTrip(tripId: UUID, itinerary: Itinerary) = itinerary.also { writes++ }
        override fun replaceIfCurrent(tripId: UUID, expectedItineraryId: UUID, itinerary: Itinerary) = true.also { writes++ }
        override fun findStalePartial(updatedBefore: Instant) = emptyList<Itinerary>()
    }

    class Agent(val answer: (EditProposalInput) -> EditProposalOutput) : StubScheduleAgent() {
        val inputs = mutableListOf<EditProposalInput>()
        override fun proposeEdit(input: EditProposalInput): EditProposalOutput {
            inputs += input
            return answer(input)
        }
    }

    fun trips(owner: UUID = acc, ctx: TripGenerationContext? = TripGenerationContext(d1, d2, emptyList(), "친구", null, emptyList())) =
        object : TripFacade {
            override fun findPeriod(accountId: UUID, tripId: UUID) = if (accountId == owner) TripPeriod(d1, d2) else null
            override fun findGenerationContext(accountId: UUID, tripId: UUID) = ctx
        }

    /** 숙소 앵커가 두 날 다 있다 — [anchored] 를 끄면 그 날의 앵커를 정할 수 없는 여행이 된다. */
    fun contexts(anchored: Boolean = true, trips: TripFacade = trips()) = RepairContexts(
        trips,
        object : BaseAnchorFacade {
            override fun findStayNightAnchors(tripId: UUID, startDate: LocalDate, endDate: LocalDate) =
                if (anchored) listOf(DayAnchorView(d1, 33.45, 126.56), DayAnchorView(d2, 33.25, 126.41)) else emptyList()
        },
        object : RegionLookupFacade {
            override fun codesOf(regionName: String) = emptyList<String>()
            override fun isSelectableCode(regionCode: String) = false
            override fun centerOf(regionName: String): RegionCenter? = null
            override fun centerOfCode(regionCode: String): RegionCenter? = null
        },
        object : PreferenceFacade {
            override fun findPreferences(accountId: UUID) =
                PreferenceSnapshot(emptyList(), emptyList(), emptyList(), listOf("렌터카", "도보"), null, emptyList(), false, "고급")
        },
    )

    fun service(agent: Agent, repo: CountingRepo = CountingRepo(stored), trips: TripFacade = trips(), contexts: RepairContexts = contexts()) =
        EditProposalService(trips, repo, agent, contexts, clock)

    /** 상대가 [d1] 의 [from] 을 [to] 로 바꾸고 시각을 30분 민 해. 다른 날은 받은 그대로 돌려준다. */
    fun replacing(from: UUID, to: UUID) = { input: EditProposalInput ->
        val days = input.itinerary.days.map { d ->
            if (d.date != d1) d
            else DaySchedule(d.date, d.slots.map { if (it.poiId == from) VisitSlotDisplay(to, it.startAt.plusMinutes(30), it.endAt.plusMinutes(30), false, "약 630m", false) else it })
        }
        EditProposalOutput(EditProposalStatus.PROPOSED, input.itinerary.copy(days = days), emptyList(), null, "AUTO_APPLY")
    }
    val utter = EditProposalRequest.Utterance("첫 장소를 조용한 카페로 바꿔줘")

    "발화 제안 — 저장된 일정 전체와 그 날의 앵커·수단·예산 등급을 싣고, 상대의 해를 일정 전체로 돌려준다" {
        val agent = Agent(replacing(a, fresh))
        val repo = CountingRepo(stored)

        val result = service(agent, repo).propose(acc, tripId, d1, utter, deadlineMs = 8_000)

        val sent = agent.inputs.single()
        sent.utterance shouldBe "첫 장소를 조용한 카페로 바꿔줘"
        sent.command shouldBe null
        sent.targetDate shouldBe d1
        (sent.anchorLat to sent.anchorLng) shouldBe (33.45 to 126.56) // d2 의 앵커가 아니다
        sent.transportMode shouldBe "렌터카"
        sent.budgetLevel shouldBe "고급"
        sent.requestMeta.deadlineMs shouldBe 8_000
        sent.itinerary.days.map { it.date } shouldContainExactly listOf(d1, d2)
        sent.itinerary.days.first().slots.map { Triple(it.poiId, it.startAt, it.isFixed) } shouldContainExactly
            listOf(Triple(a, LocalTime.of(9, 0), false), Triple(b, LocalTime.of(11, 0), true))

        val proposed = result.shouldBeInstanceOf<EditProposal.Proposed>()
        proposed.applyHint shouldBe "AUTO_APPLY"
        proposed.days.map { it.date } shouldContainExactly listOf(d1, d2) // 안 바뀐 날도 — 저장이 전체 교체다
        val first = proposed.days.first().slots.first()
        first.poiId shouldBe fresh
        first.startAt shouldBe LocalTime.of(9, 30) // 상대 조립의 시각(INV-2)
        first.distanceRange shouldBe "약 630m"
        proposed.days.first().slots.last().isFixed shouldBe true
        repo.writes shouldBe 0
    }

    "앵커는 고치려는 그 날의 것이다 — 다른 날 숙소에 후보 풀을 매달지 않는다" {
        val agent = Agent { EditProposalOutput(EditProposalStatus.NOT_UNDERSTOOD, null, emptyList(), null, null) }

        service(agent).propose(acc, tripId, d2, utter, 5_000)

        agent.inputs.single().let { (it.anchorLat to it.anchorLng) shouldBe (33.25 to 126.41) }
    }

    "교체 제안 — 슬롯 키를 명령으로 옮긴다(발화 없음)" {
        val agent = Agent(replacing(a, fresh))

        service(agent).propose(acc, tripId, d1, EditProposalRequest.ReplaceSlot("$d1#$a", fresh), 5_000)
            .shouldBeInstanceOf<EditProposal.Proposed>()

        agent.inputs.single().utterance shouldBe null
        agent.inputs.single().command shouldBe EditCommand.replaceSlot(a, fresh)
    }

    /**
     * 거절 사유 원문은 내보내지 않는다 — 상대의 진단 문장("영업시간 밖: 543~618")은 화면 문구가 아니다.
     * 위반은 일정 화면과 같은 번역으로 나간다.
     */
    "거절 — 위반을 화면 문구로 옮긴다. 붙일 슬롯이 없는 위반은 장소 없이 남는다" {
        val agent = Agent {
            EditProposalOutput(
                EditProposalStatus.REJECTED, null,
                listOf(Violation("HC1", null, null, "영업시간 밖: 543~618", fresh.toString()), Violation("HC3", null, null, null, null)),
                "편집 결과가 하드 제약을 위반", "AUTO_APPLY",
            )
        }
        val repo = CountingRepo(stored)

        val result = service(agent, repo).propose(acc, tripId, d1, utter, 5_000)

        result shouldBe EditProposal.Rejected(
            listOf(ProposalViolation(fresh, "영업시간과 맞지 않아요"), ProposalViolation(null, "꼭 갈 곳이 일정에 들어가지 못했어요")),
        )
        repo.writes shouldBe 0
    }

    "거절 — 편집 규칙에 걸린 것(위반 목록 없음)도 거절이다" {
        val agent = Agent { EditProposalOutput(EditProposalStatus.REJECTED, null, emptyList(), "예약(고정) 슬롯은 편집 대상이 될 수 없음", "AUTO_APPLY") }
        service(agent).propose(acc, tripId, d1, utter, 5_000) shouldBe EditProposal.Rejected(emptyList())
    }

    "해석 실패는 NotUnderstood 다" {
        val agent = Agent { EditProposalOutput(EditProposalStatus.NOT_UNDERSTOOD, null, emptyList(), "해석 실패", null) }
        service(agent).propose(acc, tripId, d1, utter, 5_000) shouldBe EditProposal.NotUnderstood
    }

    /** 생성 경로처럼 폴백 일정으로 내려가면 말 한마디에 일정이 갈아엎어진다. 예외로 올리면 턴이 500 이다. */
    "상대 호출이 실패하면 Unavailable — 예외도 폴백 일정도 아니다" {
        val agent = Agent { throw ScheduleAgentCallFailed(null, retryable = true, message = "connection refused") }
        val repo = CountingRepo(stored)

        service(agent, repo).propose(acc, tripId, d1, utter, 5_000) shouldBe EditProposal.Unavailable
        repo.writes shouldBe 0
    }

    "상대가 시한 안에 답하지 않으면 기다리지 않고 Unavailable 이다" {
        val agent = Agent {
            Thread.sleep(3_000)
            replacing(a, fresh)(it)
        }
        val started = System.nanoTime()

        service(agent).propose(acc, tripId, d1, utter, deadlineMs = 100) shouldBe EditProposal.Unavailable

        ((System.nanoTime() - started) / 1_000_000 < 2_000) shouldBe true
    }

    "그 날의 앵커를 정할 수 없으면 부르지 않고 Unavailable 이다 — 상대 계약상 앵커가 필수다" {
        val agent = Agent(replacing(a, fresh))

        service(agent, contexts = contexts(anchored = false)).propose(acc, tripId, d1, utter, 5_000) shouldBe EditProposal.Unavailable

        agent.inputs shouldBe emptyList()
    }

    "컨텍스트 조회가 깨져도 예외가 아니라 Unavailable 이다" {
        val broken = object : TripFacade {
            override fun findPeriod(accountId: UUID, tripId: UUID) = TripPeriod(d1, d2)
            override fun findGenerationContext(accountId: UUID, tripId: UUID): TripGenerationContext? = throw IllegalStateException("db down")
        }
        val agent = Agent(replacing(a, fresh))

        service(agent, contexts = contexts(trips = broken)).propose(acc, tripId, d1, utter, 5_000) shouldBe EditProposal.Unavailable
    }

    "타 계정·일정 없음은 404 — 상대를 부르지 않는다" {
        val agent = Agent(replacing(a, fresh))

        shouldThrow<ResourceNotFound> { service(agent).propose(UUID.randomUUID(), tripId, d1, utter, 5_000) }
        shouldThrow<ResourceNotFound> { service(agent, repo = CountingRepo(null)).propose(acc, tripId, d1, utter, 5_000) }
        agent.inputs shouldBe emptyList()
    }

    /** 여기서 안 막으면 상대의 422 가 "AI 불통"으로 보여 사용자는 다시 시도만 반복한다. */
    "입력이 틀리면 부르기 전에 막는다 — 없는 날짜·다른 날의 슬롯·없는 슬롯·깨진 키·빈 발화·긴 발화" {
        val agent = Agent(replacing(a, fresh))
        val svc = service(agent)

        listOf<() -> Any>(
            { svc.propose(acc, tripId, d2.plusDays(1), utter, 5_000) },
            // 장소는 그 날에 있지만 키의 날짜가 다르다 — 날짜를 안 보면 엉뚱한 날을 고친다
            { svc.propose(acc, tripId, d1, EditProposalRequest.ReplaceSlot("$d2#$a", fresh), 5_000) },
            { svc.propose(acc, tripId, d1, EditProposalRequest.ReplaceSlot("$d1#$c", fresh), 5_000) },
            { svc.propose(acc, tripId, d1, EditProposalRequest.ReplaceSlot("nope", fresh), 5_000) },
            { svc.propose(acc, tripId, d1, EditProposalRequest.Utterance("  "), 5_000) },
            { svc.propose(acc, tripId, d1, EditProposalRequest.Utterance("가".repeat(501)), 5_000) },
        ).forEach { shouldThrow<ValidationFailed> { it() } }
        agent.inputs shouldBe emptyList()

        svc.propose(acc, tripId, d1, EditProposalRequest.Utterance("가".repeat(500)), 5_000).shouldBeInstanceOf<EditProposal.Proposed>()
    }
})
