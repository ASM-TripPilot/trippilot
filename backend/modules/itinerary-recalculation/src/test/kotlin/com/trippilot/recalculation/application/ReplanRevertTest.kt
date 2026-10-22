package com.trippilot.recalculation.application

import com.trippilot.archive.api.ArchiveFacade
import com.trippilot.core.error.ConflictDetected
import com.trippilot.core.error.ErrorCode
import com.trippilot.itinerarygeneration.api.ItineraryFacade
import com.trippilot.itinerarygeneration.api.ItineraryPlanFacade
import com.trippilot.itinerarygeneration.api.ItineraryRef
import com.trippilot.itinerarygeneration.api.PlannedPlaceView
import com.trippilot.itinerarygeneration.api.PlannedSlotView
import com.trippilot.itinerarygeneration.api.ReplanProposal
import com.trippilot.itinerarygeneration.api.ReplanSlot
import com.trippilot.recalculation.api.event.ItineraryRecalculated
import com.trippilot.recalculation.domain.OriginKind
import com.trippilot.recalculation.domain.ReplanDiff
import com.trippilot.recalculation.domain.ReplanOrigin
import com.trippilot.recalculation.domain.ReplanScope
import com.trippilot.recalculation.domain.ReplanStatus
import com.trippilot.savedaccommodation.api.BaseAnchorFacade
import com.trippilot.savedaccommodation.api.DayAnchorView
import com.trippilot.trip.api.TripFacade
import com.trippilot.trip.api.TripGenerationContext
import com.trippilot.trip.api.TripPeriod
import io.kotest.assertions.throwables.shouldThrow
import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.collections.shouldBeEmpty
import io.kotest.matchers.collections.shouldContainExactly
import io.kotest.matchers.shouldBe
import io.kotest.matchers.shouldNotBe
import java.time.Clock
import java.time.Instant
import java.time.LocalDate
import java.time.LocalTime
import java.time.ZoneOffset
import java.util.UUID

/**
 * 원탭 [다시 짜기] 적용 뒤(TRIP-1412) — 반영된 재계획의 "빠진 곳"과 되돌리기.
 *
 * 원탭은 초안을 보자마자 반영한다. 그래서 이 스펙이 지키는 것은 둘이다:
 * - 반영 **뒤에도** 무엇이 빠졌는지 볼 수 있다 — 반영 순간 떠 둔 기준이 반영 직전 비교와 같은 말을 한다
 * - 되돌리기는 그 날을 반영 직전으로 돌리되, **다녀온 곳을 지우지 않는다**(INV-U4-04)
 *
 * 일정 쪽 판정(그 사이 바뀐 날 · 확정 동결)은 C8 스펙(`ReplanFacadeServiceTest`)이 본다.
 */
class ReplanRevertTest : StringSpec({

    val acc = UUID.randomUUID()
    val trip = UUID.randomUUID()
    val today = LocalDate.parse("2026-08-11")
    // KST 정오 — 여행 "오늘"이 UTC 와 어긋나지 않는 시각을 고른다.
    val noon = Clock.fixed(Instant.parse("2026-08-11T03:00:00Z"), ZoneOffset.UTC)

    val trips = object : TripFacade {
        override fun findPeriod(accountId: UUID, tripId: UUID) =
            if (accountId == acc && tripId == trip) TripPeriod(today.minusDays(1), today.plusDays(2)) else null

        override fun findGenerationContext(accountId: UUID, tripId: UUID): TripGenerationContext? = null
    }
    val itineraries = object : ItineraryFacade {
        override fun findCurrent(accountId: UUID, tripId: UUID) =
            ItineraryRef(FakeReplans.ITINERARY_ID, "CONFIRMED", "COMPLETE", listOf(today, today.plusDays(1)), emptyList())
    }
    val noAnchors = object : BaseAnchorFacade {
        override fun findStayNightAnchors(tripId: UUID, startDate: LocalDate, endDate: LocalDate) = emptyList<DayAnchorView>()
    }

    val kept = UUID.randomUUID()
    val dropped = UUID.randomUUID()
    val added = UUID.randomUUID()
    fun t(s: String): LocalTime = LocalTime.parse(s)

    /** 반영 전 오늘 — 두 곳. 하나(kept)는 재계획 뒤에도 남고 하나(dropped)는 빠진다. 다른 날 한 곳은 비교에 섞이면 안 된다. */
    val plans = object : ItineraryPlanFacade {
        var slots = listOf(
            PlannedSlotView("$today#$kept", today, kept, 0, t("10:00"), t("11:00"), isFixed = false, endsNextDay = false, hasViolation = false, nameKo = "남는 곳", lat = 33.1, lng = 126.1),
            PlannedSlotView("$today#$dropped", today, dropped, 1, t("14:00"), t("15:00"), isFixed = false, endsNextDay = false, hasViolation = false, nameKo = "빠지는 곳", lat = 33.2, lng = 126.2),
            PlannedSlotView("${today.plusDays(1)}#${UUID.randomUUID()}", today.plusDays(1), UUID.randomUUID(), 0, t("10:00"), t("11:00"), isFixed = false, endsNextDay = false, hasViolation = false),
        )
        override fun findPlanSlots(accountId: UUID, tripId: UUID) = slots
        override fun findPlannedPlaces(accountId: UUID, tripId: UUID) = emptyMap<LocalDate, List<PlannedPlaceView>>()
    }

    fun slot(poi: UUID, start: String, end: String, snapshot: UUID? = null) =
        ReplanSlot(poi, t(start), t(end), isFixed = false, endsNextDay = false, distanceRange = null, placementReason = null, hasViolation = false, violationReason = null, poiSnapshotId = snapshot)

    val draft = ReplanProposal(FakeReplans.ITINERARY_ID, today, listOf(slot(kept, "10:00", "11:00"), slot(added, "14:00", "15:30")))
    val restorePoint = ReplanProposal(
        FakeReplans.ITINERARY_ID, today,
        listOf(slot(kept, "10:00", "11:00", UUID.randomUUID()), slot(dropped, "14:00", "15:00", UUID.randomUUID())),
    )

    class Fx(val replans: FakeReplans, val sessions: InMemoryReplanSessions, val events: CapturingReplanEvents, val service: ReplanSessionService)

    fun fixture(visited: Set<String> = emptySet(), clock: Clock = noon): Fx {
        val replans = FakeReplans(proposal = draft).also { it.restorePoint = restorePoint }
        val sessions = InMemoryReplanSessions()
        val events = CapturingReplanEvents()
        val archive: ArchiveFacade = FakeArchive(visitedSlots = visited)
        val service = ReplanSessionService(
            trips, itineraries, sessions, OriginResolver(noAnchors), archive, NO_SURFACES,
            ReplanSolver(sessions, archive, replans, NOOP_TX, clock), replans, FakeLocationConsents(), CapturingLegalLogs(), FakeTripPurgeScope(),
            events, clock, FakeTriggerLookup(), plans, ReplanProperties(),
        )
        return Fx(replans, sessions, events, service)
    }

    fun Fx.appliedSession(): UUID {
        val opened = service.start(
            acc, trip,
            StartReplan(
                triggerId = null, scope = ReplanScope.PARTIAL_SLOTS, targetDate = null, origin = ReplanOrigin(OriginKind.GPS, 33.45, 126.56),
                reasons = listOf("비가 와요"), directives = listOf("실내로"), freeText = null, excludedPoiIds = emptyList(),
            ),
        )
        service.apply(acc, trip, opened.sessionId)
        return opened.sessionId
    }

    "반영하면 그 날의 반영 직전 비교 기준과 되돌리기 지점이 세션에 남는다 — 다른 날은 섞이지 않는다" {
        val f = fixture()
        val sid = f.appliedSession()

        val s = f.sessions.stored.getValue(sid)
        s.status shouldBe ReplanStatus.APPLIED
        s.appliedBefore!!.map { it.slotKey } shouldContainExactly listOf("$today#$kept", "$today#$dropped")
        s.appliedBefore!!.map { it.nameKo } shouldContainExactly listOf("남는 곳", "빠지는 곳") // 표면도 함께 — 반영 뒤엔 원본이 없다
        ReplanProposal.fromMap(s.restorePoint!!) shouldBe restorePoint
        s.isRevertible shouldBe true
    }

    // AC 1 — 원탭 적용 직후 diff 가 APPLIED 에서 ready=true 와 제외 항목(장소·시각)을 준다.
    "반영 뒤 비교가 빠진 곳을 준다 — 반영 직전 비교와 같은 판정이다" {
        val f = fixture()
        val sid = f.appliedSession()
        // 반영으로 일정이 바뀐 뒤를 흉내 낸다 — 비교가 지금 일정을 다시 읽으면 빠진 곳이 사라진다.
        val original = plans.slots
        plans.slots = emptyList()
        try {
            val diff = ReplanDiffService(f.service, plans, NO_SURFACES).diff(acc, trip, sid)

            diff.ready shouldBe true
            diff.status shouldBe ReplanStatus.APPLIED
            val removed = diff.result!!.entries.filter { it.change == ReplanDiff.Change.REMOVED }
            removed.map { it.slotKey } shouldContainExactly listOf("$today#$dropped")
            removed.single().beforeStart shouldBe t("14:00")
            diff.result!!.entries.single { it.change == ReplanDiff.Change.ADDED }.slotKey shouldBe "$today#$added"
        } finally {
            plans.slots = original
        }
    }

    "되돌리면 C8 에 반영본과 되돌리기 지점이 그대로 가고 세션에 되돌린 시각이 남는다 — 상태는 APPLIED 그대로" {
        val f = fixture()
        val sid = f.appliedSession()

        val reverted = f.service.revert(acc, trip, sid)

        reverted.status shouldBe ReplanStatus.APPLIED
        reverted.revertedAt shouldNotBe null
        reverted.isRevertible shouldBe false
        val (applied, restore, reason) = f.replans.reverted.single()
        applied shouldBe draft
        restore shouldBe restorePoint
        // BR-U4-31 — 되돌렸다는 사실이 앞에, 무엇을 되돌렸는지(원래 사유)가 뒤에.
        reason shouldBe "재계획 되돌림 · 비가 와요 · 실내로"
    }

    "되돌리면 알림 재적재 사건이 나간다 — 트리거는 싣지 않는다(이미 소비된 트리거를 건드리지 않는다)" {
        val f = fixture()
        val sid = f.appliedSession()
        f.events.published.clear()

        f.service.revert(acc, trip, sid)

        val event = f.events.published.single() as ItineraryRecalculated
        event.aggregateId shouldBe trip.toString()
        event.triggerId shouldBe null
        event.targetDate shouldBe today.toString()
    }

    "두 번 되돌릴 수 없다" {
        val f = fixture()
        val sid = f.appliedSession()
        f.service.revert(acc, trip, sid)

        shouldThrow<ConflictDetected> { f.service.revert(acc, trip, sid) }.message shouldBe "이미 되돌린 재계획입니다."
        f.replans.reverted.size shouldBe 1
    }

    "반영 전 세션은 되돌릴 수 없다 — 아무것도 바뀐 게 없다" {
        val f = fixture()
        val opened = f.service.start(
            acc, trip,
            StartReplan(
                triggerId = null, scope = ReplanScope.PARTIAL_SLOTS, targetDate = null, origin = ReplanOrigin(OriginKind.GPS, 33.45, 126.56),
                reasons = emptyList(), directives = emptyList(), freeText = null, excludedPoiIds = emptyList(),
            ),
        )

        shouldThrow<ConflictDetected> { f.service.revert(acc, trip, opened.sessionId) }.message shouldBe "되돌릴 재계획이 없습니다."
        f.replans.reverted.shouldBeEmpty()
    }

    "이 기능 이전에 반영된 세션은 되돌리기 지점이 없어 409 다 — 지어내지 않는다" {
        val f = fixture()
        val sid = f.appliedSession()
        f.sessions.stored[sid] = f.sessions.stored.getValue(sid).copy(appliedBefore = null, restorePoint = null)

        shouldThrow<ConflictDetected> { f.service.revert(acc, trip, sid) }.message shouldBe "이 재계획은 되돌릴 수 없어요."
        ReplanDiffService(f.service, plans, NO_SURFACES).diff(acc, trip, sid).ready shouldBe false
        f.replans.reverted.shouldBeEmpty()
    }

    // INV-U4-04 판정은 C8 이 일정 쓰기 잠금을 잡은 뒤 한다(ReplanFacadeServiceTest). 여기서 볼 것은 **무엇을 넘기는가** —
    // 완료만 넘기면 도착만 한 기록이 되돌린 뒤 고아가 된다.
    "다녀온 기록은 도착만 한 것까지 C8 에 넘긴다 — 완료분만이 아니다" {
        val arrivedOnly = "$today#$added"
        val f = fixture(visited = setOf(arrivedOnly))
        val sid = f.appliedSession()

        f.service.revert(acc, trip, sid)

        f.replans.visitedSeen.single() shouldBe setOf(arrivedOnly)
    }

    "되돌리기 지점에 slots 가 없으면 409 — 그 날을 조용히 비우지 않는다" {
        val f = fixture()
        val sid = f.appliedSession()
        val s = f.sessions.stored.getValue(sid)
        f.sessions.stored[sid] = s.copy(restorePoint = s.restorePoint!! - "slots")

        shouldThrow<ConflictDetected> { f.service.revert(acc, trip, sid) }.message shouldBe "이 재계획은 되돌릴 수 없어요."
        f.replans.reverted.shouldBeEmpty()
        f.sessions.stored.getValue(sid).revertedAt shouldBe null
    }

    "되돌리기 지점이 깨졌으면 409 — 500 으로 새지 않는다" {
        val f = fixture()
        val sid = f.appliedSession()
        val s = f.sessions.stored.getValue(sid)
        f.sessions.stored[sid] = s.copy(restorePoint = s.restorePoint!! - "itineraryId")

        shouldThrow<ConflictDetected> { f.service.revert(acc, trip, sid) }.message shouldBe "이 재계획은 되돌릴 수 없어요."
        f.replans.reverted.shouldBeEmpty()
    }

    "반영 전 그 날이 비어 있었으면 빈 지점으로 되돌린다 — 빈 목록은 사실이다" {
        val f = fixture()
        f.replans.restorePoint = restorePoint.copy(slots = emptyList())
        val sid = f.appliedSession()

        f.service.revert(acc, trip, sid)

        f.replans.reverted.single().second.slots shouldBe emptyList()
    }

    "지난 날의 재계획은 되돌릴 수 없다 — 지나간 하루의 계획을 바꾸지 않는다" {
        val f = fixture()
        val sid = f.appliedSession()
        val tomorrowNoon = Clock.fixed(Instant.parse("2026-08-12T03:00:00Z"), ZoneOffset.UTC)
        val later = ReplanSessionService(
            trips, itineraries, f.sessions, OriginResolver(noAnchors), FakeArchive(), NO_SURFACES,
            ReplanSolver(f.sessions, FakeArchive(), f.replans, NOOP_TX, tomorrowNoon), f.replans, FakeLocationConsents(), CapturingLegalLogs(),
            FakeTripPurgeScope(), f.events, tomorrowNoon, FakeTriggerLookup(), plans, ReplanProperties(),
        )

        shouldThrow<ConflictDetected> { later.revert(acc, trip, sid) }.message shouldBe "지난 날의 재계획은 되돌릴 수 없어요."
        f.replans.reverted.shouldBeEmpty()
    }

    "그 사이 그 날이 바뀌어 C8 이 거절하면 세션도 되돌린 것으로 남지 않는다" {
        val f = fixture()
        val sid = f.appliedSession()
        f.replans.revertFailWith = ConflictDetected(message = "그 사이 일정이 바뀌어 되돌릴 수 없어요.", errorCode = ErrorCode.STALE)

        shouldThrow<ConflictDetected> { f.service.revert(acc, trip, sid) }.errorCode shouldBe ErrorCode.STALE
        f.sessions.stored.getValue(sid).revertedAt shouldBe null
    }

    "다른 여행의 세션은 되돌릴 수 없다(404 은닉)" {
        val f = fixture()
        val sid = f.appliedSession()

        shouldThrow<com.trippilot.core.error.ResourceNotFound> { f.service.revert(acc, UUID.randomUUID(), sid) }
        f.replans.reverted.shouldBeEmpty()
    }
})
