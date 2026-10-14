package com.trippilot.itinerarygeneration.adapter.out.external

import com.trippilot.itinerarygeneration.domain.FixedBlock
import com.trippilot.itinerarygeneration.domain.GenerationMode
import com.trippilot.itinerarygeneration.domain.PreferenceProfile
import com.trippilot.itinerarygeneration.domain.ReplanInput
import com.trippilot.itinerarygeneration.domain.ReplanScope
import com.trippilot.itinerarygeneration.domain.RequestMeta
import com.trippilot.itinerarygeneration.domain.ScheduleAgentInput
import com.trippilot.itinerarygeneration.domain.SolveMode
import com.trippilot.itinerarygeneration.domain.TimeWindow
import com.trippilot.itinerarygeneration.domain.TripContext
import com.trippilot.placedata.api.Area
import com.trippilot.placedata.api.CandidatePoolPort
import com.trippilot.placedata.api.GroundedPlace
import com.trippilot.itinerarygeneration.domain.DaySchedule
import com.trippilot.itinerarygeneration.domain.EditCommand
import com.trippilot.itinerarygeneration.domain.EditProposalInput
import com.trippilot.itinerarygeneration.domain.EditProposalStatus
import com.trippilot.itinerarygeneration.domain.FreshnessMeta
import com.trippilot.itinerarygeneration.domain.ScheduleAgentOutput
import com.trippilot.itinerarygeneration.domain.VisitSlotDisplay
import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.collections.shouldContain
import io.kotest.matchers.comparables.shouldBeGreaterThan
import io.kotest.matchers.shouldBe
import java.time.Clock
import java.time.Instant
import java.time.LocalDate
import java.time.LocalTime
import java.time.ZoneOffset
import java.util.UUID

/** Fake 에이전트 — 실 ACTIVE 후보(정본) emit(가짜 UUID 아님)·고정 블록 반영·결정론. 동결(272) 가능하게 실 poiId. */
class FakeScheduleAgentTest : StringSpec({

    /** 슬롯 후보 로직은 공용 [LocalSlotCandidateSource] 가 갖는다 — 대역도 같은 것을 쓴다. */
    fun agentOf(pool: CandidatePoolPort, clock: java.time.Clock) =
        FakeScheduleAgent(pool, LocalSlotCandidateSource(pool, clock), clock)

    val clock = Clock.fixed(Instant.parse("2026-08-06T00:00:00Z"), ZoneOffset.UTC)
    val poiA = UUID.randomUUID()
    val poiB = UUID.randomUUID()
    val fixedPoi = UUID.randomUUID()
    val d1 = LocalDate.parse("2026-08-01")

    fun pool(region: String, places: List<GroundedPlace>) = object : CandidatePoolPort {
        override fun resolve(area: Area, categories: Set<String>): List<GroundedPlace> =
            if (area is Area.Region && area.region == region) places else emptyList()
        override fun ground(poiIds: List<UUID>): List<GroundedPlace> = emptyList()
    }

    fun input(destinations: List<String>, fixed: List<FixedBlock>) = ScheduleAgentInput(
        tripId = UUID.randomUUID(),
        generationMode = GenerationMode.FULLY_AI,
        tripContext = TripContext(destinations, d1, d1, "친구", null),
        anchors = emptyList(),
        timeWindows = listOf(TimeWindow(d1, LocalTime.of(9, 0), LocalTime.of(21, 0))),
        fixedBlocks = fixed,
        preferenceProfile = PreferenceProfile(emptyList(), emptyList(), emptyList(), emptyList(), null, emptyList(), false, null),
        recommendationStrength = null,
        requestMeta = RequestMeta("r", clock.instant(), 20_000),
    )

    "실 후보 POI + 고정 블록을 결정론 emit(가짜 UUID 아님)" {
        val places = listOf(
            GroundedPlace(poiA, "성산", 33.4, 126.9, "자연", "제주", null),
            GroundedPlace(poiB, "한라산", 33.3, 126.5, "자연", "제주", null),
        )
        val agent = agentOf(pool("제주", places), clock)
        val inp = input(listOf("제주"), listOf(FixedBlock(fixedPoi, d1, LocalTime.of(12, 0), 90)))

        val out = agent.generate(inp)
        out.solveMode shouldBe SolveMode.DETERMINISTIC
        out.isFallback shouldBe false
        val slots = out.days.single().slots
        slots.any { it.poiId == fixedPoi && it.isFixed } shouldBe true // 고정 블록(HC3)
        slots.map { it.poiId } shouldContain poiA                       // 실 후보(정본)
        // 결정론: 같은 입력 재실행 동일 순서
        agent.generate(inp).days.single().slots.map { it.poiId } shouldBe slots.map { it.poiId }
    }

    "후보 지역에 POI 없으면 고정 블록만" {
        val agent = agentOf(pool("제주", emptyList()), clock)
        val out = agent.generate(input(listOf("부산"), listOf(FixedBlock(fixedPoi, d1, LocalTime.of(12, 0), 90))))
        out.days.single().slots.all { it.isFixed } shouldBe true
    }

    "시각 없는 고정 블록(날짜만, TRIP-1249)은 창 시작에 놓이고 고정으로 표시된다 — 실 AI 의 is_fixed=true 를 비춘다" {
        val agent = agentOf(pool("제주", emptyList()), clock)
        val out = agent.generate(input(listOf("제주"), listOf(FixedBlock(fixedPoi, d1, null, 90))))
        val slot = out.days.single().slots.single()
        slot.poiId shouldBe fixedPoi
        slot.startAt shouldBe LocalTime.of(9, 0)
        slot.endAt shouldBe LocalTime.of(10, 30)
        slot.isFixed shouldBe true
    }

    "창이 좁으면(지금부터 연 오늘) 창 안에 드는 자리만 놓는다 — 창 밖·자정 감김 자리를 만들지 않는다" {
        val places = listOf(
            GroundedPlace(poiA, "성산", 33.4, 126.9, "자연", "제주", null),
            GroundedPlace(poiB, "한라산", 33.3, 126.5, "자연", "제주", null),
        )
        val agent = agentOf(pool("제주", places), clock)
        // 20:00 시작이면 종전엔 둘째 자리가 23:00~00:00 이었다(자정 감김).
        val narrow = input(listOf("제주"), emptyList()).copy(timeWindows = listOf(TimeWindow(d1, LocalTime.of(20, 0), LocalTime.of(21, 0))))

        val slots = agent.generate(narrow).days.single().slots
        slots.map { it.startAt } shouldBe listOf(LocalTime.of(20, 0))
    }

    /**
     * 늦은 시각 재계획 — 기계적으로 3시간씩 더하면 **자정을 넘어** `endAt < startAt` 인 슬롯이 나오고,
     * 도메인 검증(HC4 플래그 없이 되감김)에 걸려 사용자에게 500 이 된다.
     * 실측으로 CI 만 실패했다(19:33 KST) — 시각에 따라 갈리는 결함이라 고정 시각으로 못 박는다.
     */
    "밤 늦게 재계획해도 자정을 넘는 슬롯을 만들지 않는다" {
        val places = listOf(
            GroundedPlace(poiA, "성산", 33.4, 126.9, "자연", "제주", null),
            GroundedPlace(poiB, "한라산", 33.3, 126.5, "자연", "제주", null),
        )
        // 22:30 KST — 30분 뒤면 23:00 이고 한 시간이면 자정이다. `endsNextDay` 없이는 표현할 수 없으니
        // **아무것도 만들지 않는 것**이 맞다. 화면에는 "대안 없음"으로 나가 수동 편집으로 넘어간다.
        val lateClock = Clock.fixed(Instant.parse("2026-08-01T13:30:00Z"), ZoneOffset.UTC)
        val agent = agentOf(pool("제주", places), lateClock)

        val out = agent.replan(
            ReplanInput(
                tripId = UUID.randomUUID(), itineraryId = UUID.randomUUID(),
                scope = ReplanScope.PARTIAL_SLOTS, destinations = listOf("제주"),
                fromInstant = lateClock.instant(), targetDate = d1,
                originLat = 33.4, originLng = 126.5, lockedBlocks = emptyList(),
                reasons = emptyList(), directives = emptyList(), freeText = null,
                excludedPoiIds = emptyList(),
                companionType = null, budgetLevel = null,
                preferenceProfile = PreferenceProfile(emptyList(), emptyList(), emptyList(), emptyList(), null, emptyList(), false, null),
                currentSlots = emptyList(), savedPlaces = emptyList(),
                rejections = emptyList(),
                requestMeta = RequestMeta("r", lateClock.instant(), 10_000),
            ),
        )

        out.days.single().slots shouldBe emptyList()
    }

    /** 대조군 — 이른 시각에는 정상적으로 자리가 나온다(위 테스트가 "항상 0건"으로 통과하지 않게). */
    "낮에 재계획하면 자리가 나온다" {
        val places = listOf(
            GroundedPlace(poiA, "성산", 33.4, 126.9, "자연", "제주", null),
            GroundedPlace(poiB, "한라산", 33.3, 126.5, "자연", "제주", null),
        )
        val noonClock = Clock.fixed(Instant.parse("2026-08-01T03:00:00Z"), ZoneOffset.UTC) // 12:00 KST
        val agent = agentOf(pool("제주", places), noonClock)

        val out = agent.replan(
            ReplanInput(
                tripId = UUID.randomUUID(), itineraryId = UUID.randomUUID(),
                scope = ReplanScope.PARTIAL_SLOTS, destinations = listOf("제주"),
                fromInstant = noonClock.instant(), targetDate = d1,
                originLat = 33.4, originLng = 126.5, lockedBlocks = emptyList(),
                reasons = emptyList(), directives = emptyList(), freeText = null,
                excludedPoiIds = emptyList(),
                companionType = null, budgetLevel = null,
                preferenceProfile = PreferenceProfile(emptyList(), emptyList(), emptyList(), emptyList(), null, emptyList(), false, null),
                currentSlots = emptyList(), savedPlaces = emptyList(),
                rejections = emptyList(),
                requestMeta = RequestMeta("r", noonClock.instant(), 10_000),
            ),
        )

        val slots = out.days.single().slots
        slots.size shouldBe 2
        slots.forEach { it.endAt shouldBeGreaterThan it.startAt }
    }
    /**
     * 기본 모드에서 도우미의 "후보 고르기 → 제안" 이 끝까지 돌게 하는 대역이다. 발화는 해석하지 않는다 —
     * 대역이 지어낸 해석이 "되는 것처럼" 보이면 실 연동에서야 처음 틀린다.
     */
    "편집 제안 — 그 날 슬롯 하나를 정본에 있는 장소로 바꾼다(시각은 자리 그대로), 발화는 해석하지 않는다" {
        val d2 = d1.plusDays(1)
        val grounded = object : CandidatePoolPort {
            override fun resolve(area: Area, categories: Set<String>) = emptyList<GroundedPlace>()
            override fun ground(poiIds: List<UUID>) =
                poiIds.filter { it == poiB }.map { GroundedPlace(it, "한라산", 33.3, 126.5, "자연", "제주", null) }
        }
        val agent = agentOf(grounded, clock)
        fun slot(poi: UUID) = VisitSlotDisplay(poi, LocalTime.of(10, 0), LocalTime.of(11, 0), false, "약 1km", isFixed = false)
        val itinerary = ScheduleAgentOutput(
            days = listOf(DaySchedule(d1, listOf(slot(poiA))), DaySchedule(d2, listOf(slot(poiA)))),
            day1ReadyAt = null, explanations = emptyMap(), solveMode = SolveMode.DETERMINISTIC, isFallback = false,
            freshness = FreshnessMeta(clock.instant(), degraded = false),
        )
        fun input(utterance: String? = null, command: EditCommand? = null) = EditProposalInput(
            UUID.randomUUID(), itinerary, d1, 33.4, 126.9, null, null, utterance, command, RequestMeta("r", clock.instant(), 5_000),
        )

        val out = agent.proposeEdit(input(command = EditCommand.replaceSlot(poiA, poiB)))
        out.status shouldBe EditProposalStatus.PROPOSED
        val replaced = out.itinerary!!.days.first().slots.single()
        replaced.poiId shouldBe poiB
        replaced.startAt shouldBe LocalTime.of(10, 0)
        replaced.distanceRange shouldBe null // 구간이 바뀌었다 — 옛 거리를 물려주면 거짓이다
        out.itinerary!!.days.last().slots.single().poiId shouldBe poiA // 같은 장소라도 다른 날은 그대로

        // 정본에 없는 장소 · 그 날에 없는 슬롯 · 모르는 명령은 거절이다(INV-1)
        agent.proposeEdit(input(command = EditCommand.replaceSlot(poiA, UUID.randomUUID()))).status shouldBe EditProposalStatus.REJECTED
        agent.proposeEdit(input(command = EditCommand.replaceSlot(poiB, poiB))).status shouldBe EditProposalStatus.REJECTED
        agent.proposeEdit(input(command = EditCommand("CLEAR_DAY", emptyMap(), emptyList()))).status shouldBe EditProposalStatus.REJECTED
        agent.proposeEdit(input(utterance = "카페로 바꿔줘")).status shouldBe EditProposalStatus.NOT_UNDERSTOOD
    }
})
