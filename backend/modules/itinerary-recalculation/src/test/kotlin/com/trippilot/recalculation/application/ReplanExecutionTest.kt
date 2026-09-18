package com.trippilot.recalculation.application

import com.trippilot.core.error.ConflictDetected
import com.trippilot.itinerarygeneration.api.ItineraryFacade
import com.trippilot.itinerarygeneration.api.ItineraryRef
import com.trippilot.itinerarygeneration.api.ReplanProposal
import com.trippilot.placedata.api.FrozenPoiView
import com.trippilot.savedaccommodation.api.BaseAnchorFacade
import com.trippilot.savedaccommodation.api.DayAnchorView
import com.trippilot.placedata.api.PoiSurfaceFacade
import com.trippilot.placedata.api.PoiSurfaceView
import com.trippilot.recalculation.domain.OriginKind
import com.trippilot.recalculation.domain.ReplanOrigin
import com.trippilot.recalculation.domain.ReplanScope
import com.trippilot.recalculation.domain.ReplanSession
import com.trippilot.recalculation.domain.ReplanSessionRepository
import com.trippilot.recalculation.domain.ReplanStatus
import com.trippilot.trip.api.TripFacade
import com.trippilot.trip.api.TripGenerationContext
import com.trippilot.trip.api.TripPeriod
import io.kotest.assertions.throwables.shouldThrow
import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.collections.shouldContainExactly
import io.kotest.matchers.shouldBe
import java.time.Clock
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneOffset
import java.util.UUID

private class ExecSessions : ReplanSessionRepository {
    val store = linkedMapOf<UUID, ReplanSession>()
    override fun save(session: ReplanSession) = session.also { store[it.sessionId] = it }
    override fun findById(sessionId: UUID) = store[sessionId]
    // 단일 스레드 테스트라 잠금은 의미가 없다 — 경합 자체는 실 DB IT 가 검증한다.
    override fun findByIdForUpdate(sessionId: UUID) = store[sessionId]
    override fun findOpenByTrip(tripId: UUID) = store.values.firstOrNull { it.tripId == tripId && it.isOpen }
}

/**
 * 재계획 실행(U4 정본 §3 · INV-U4-04·05 · US-PLANB-11).
 *
 * 이 스펙이 지키는 것은 하나다 — **확정 전에는 일정이 그대로다.** 산출·대안 없음·실패·취소 어느 경로에서도
 * 일정에 쓰기가 없어야 [취소]가 원상복구를 보장한다(US-PLANB-08). 반영은 `apply` 하나뿐이다.
 */
class ReplanExecutionTest : StringSpec({

    val acc = UUID.randomUUID()
    val trip = UUID.randomUUID()
    val today = LocalDate.parse("2026-08-11")
    // KST 정오 — 여행 "오늘"이 UTC 와 어긋나지 않는 시각을 고른다.
    val clock = Clock.fixed(Instant.parse("2026-08-11T03:00:00Z"), ZoneOffset.UTC)

    val trips = object : TripFacade {
        override fun findPeriod(accountId: UUID, tripId: UUID) =
            if (accountId == acc && tripId == trip) TripPeriod(today.minusDays(1), today.plusDays(2)) else null

        override fun findGenerationContext(accountId: UUID, tripId: UUID): TripGenerationContext? = null
    }
    val itineraries = object : ItineraryFacade {
        override fun findCurrent(accountId: UUID, tripId: UUID) =
            ItineraryRef(FakeReplans.ITINERARY_ID, "PLANNED", "COMPLETE", listOf(today), emptyList())
    }
    // 기준점 사다리는 GPS 로 끝나 앵커까지 안 내려간다 — 빈 구현으로 충분하다.
    val noAnchors = object : BaseAnchorFacade {
        override fun findStayNightAnchors(tripId: UUID, startDate: LocalDate, endDate: LocalDate) = emptyList<DayAnchorView>()
    }
    val surfaces = object : PoiSurfaceFacade {
        override fun findSurfaces(poiIds: Collection<UUID>) = emptyMap<UUID, PoiSurfaceView>()
        override fun findFrozenSurfaces(poiSnapshotIds: Collection<UUID>) = emptyMap<UUID, FrozenPoiView>()
    }

    class Fixture(val replans: FakeReplans) {
        val sessions = ExecSessions()
        val events = CapturingReplanEvents()
        lateinit var service: ReplanSessionService
    }

    fun fixture(replans: FakeReplans = FakeReplans()): Fixture = Fixture(replans).apply {
        val archive = FakeArchive()
        service = ReplanSessionService(
            trips, itineraries, sessions, OriginResolver(noAnchors), archive, surfaces,
            ReplanSolver(sessions, archive, replans, NOOP_TX, clock), replans, events, clock,
        )
    }

    fun Fixture.start(scope: ReplanScope = ReplanScope.PARTIAL_SLOTS) = service.start(
        acc, trip,
        StartReplan(
            triggerId = null, scope = scope, origin = ReplanOrigin(OriginKind.GPS, 33.45, 126.56),
            reasons = listOf("비가 와요"), directives = listOf("실내로"), freeText = null, excludedPoiIds = emptyList(),
        ),
    )

    // 단위 테스트엔 Spring 프록시가 없어 @Async 가 안 걸린다 → 산출이 그 자리에서 끝난다(결정론).
    "해가 있으면 DRAFT 로 초안이 남는다 — 원 일정은 그대로다" {
        val f = fixture()
        val opened = f.start()

        val stored = f.sessions.store.getValue(opened.sessionId)
        stored.status shouldBe ReplanStatus.DRAFT
        stored.draft shouldBe f.replans.proposal!!.toMap()
        f.replans.applied shouldBe emptyList() // INV-U4-05 — 확정 전에는 반영 없음
    }

    "해가 없으면 NO_SOLUTION 으로 닫는다 — 빈 초안을 보여 주지 않는다" {
        val f = fixture(FakeReplans(proposal = null))
        val opened = f.start()

        val stored = f.sessions.store.getValue(opened.sessionId)
        stored.status shouldBe ReplanStatus.NO_SOLUTION
        stored.draft shouldBe null
        f.replans.applied shouldBe emptyList()
    }

    // 삼키면 사용자는 "생각 중"인 화면을 영원히 본다(INV-4 · US-PLANB-11).
    "AI 가 실패하면 FAILED 로 드러낸다 — 수동 편집으로 넘어갈 수 있다" {
        val f = fixture(FakeReplans(failWith = IllegalStateException("agent down")))
        val opened = f.start()

        f.sessions.store.getValue(opened.sessionId).status shouldBe ReplanStatus.FAILED
        f.replans.applied shouldBe emptyList()
    }

    "확정하면 그때 한 번 반영되고 세션이 닫힌다" {
        val f = fixture()
        val opened = f.start()

        val applied = f.service.apply(acc, trip, opened.sessionId)

        applied.status shouldBe ReplanStatus.APPLIED
        f.replans.applied.map { it.date } shouldContainExactly listOf(today)
        f.events.published.map { it.eventType } shouldContainExactly listOf("recalculation.ItineraryRecalculated")
    }

    // BR-U4-31 — 이력의 '왜' 칸은 C10 이 조립한다(스냅숏은 C8). 비면 이력을 열어도 되짚을 근거가 없다.
    "확정 시 사유·지시어가 이력 문구로 이어진다" {
        val f = fixture()
        val opened = f.start()

        f.service.apply(acc, trip, opened.sessionId)

        f.replans.appliedReasons.single() shouldBe "비가 와요 · 실내로"
    }

    "자동 진입이면 그 사실이 문구 앞에 남는다" {
        val f = fixture()
        val opened = f.service.start(
            acc, trip,
            StartReplan(
                triggerId = UUID.randomUUID(), scope = ReplanScope.PARTIAL_SLOTS,
                origin = ReplanOrigin(OriginKind.GPS, 33.45, 126.56),
                reasons = listOf("비가 와요"), directives = listOf("실내로"),
                freeText = null, excludedPoiIds = emptyList(),
            ),
        )

        f.service.apply(acc, trip, opened.sessionId)

        f.replans.appliedReasons.single() shouldBe "자동 감지 · 비가 와요 · 실내로"
    }

    // 사유를 하나도 안 고르고 확정할 수 있다 — 그때도 빈 칸으로 남기지 않는다.
    "사유를 하나도 안 골라도 최소 문구는 남는다" {
        val f = fixture()
        val opened = f.service.start(
            acc, trip,
            StartReplan(
                triggerId = null, scope = ReplanScope.PARTIAL_SLOTS,
                origin = ReplanOrigin(OriginKind.GPS, 33.45, 126.56),
                reasons = emptyList(), directives = emptyList(), freeText = "   ", excludedPoiIds = emptyList(),
            ),
        )

        f.service.apply(acc, trip, opened.sessionId)

        f.replans.appliedReasons.single() shouldBe "여행 중 재계획"
    }

    // reason 은 varchar(500) — 넘치면 확정 저장이 통째로 실패한다(자유입력은 사용자가 길게 쓴다).
    "자유입력이 길어도 컬럼 상한을 넘기지 않는다" {
        val f = fixture()
        val opened = f.service.start(
            acc, trip,
            StartReplan(
                triggerId = null, scope = ReplanScope.PARTIAL_SLOTS,
                origin = ReplanOrigin(OriginKind.GPS, 33.45, 126.56),
                reasons = emptyList(), directives = emptyList(),
                freeText = "가".repeat(900), excludedPoiIds = emptyList(),
            ),
        )

        f.service.apply(acc, trip, opened.sessionId)

        f.replans.appliedReasons.single().length shouldBe 500
    }

    // 초안 왕복(jsonb)에서 값이 새면 확정 순간 그 값이 사라진다.
    "초안은 세션에 저장됐다 돌아와도 같은 값이다" {
        val f = fixture()
        val opened = f.start()

        val restored = ReplanProposal.fromMap(f.sessions.store.getValue(opened.sessionId).draft!!)

        restored shouldBe f.replans.proposal!!
    }

    "같은 초안을 두 번 확정할 수 없다 — 두 번 반영되면 일정이 중복으로 덮인다" {
        val f = fixture()
        val opened = f.start()
        f.service.apply(acc, trip, opened.sessionId)

        shouldThrow<ConflictDetected> { f.service.apply(acc, trip, opened.sessionId) }
        f.replans.applied.size shouldBe 1
    }

    "대안 없음·실패 세션은 확정할 수 없다" {
        val none = fixture(FakeReplans(proposal = null))
        val noneOpened = none.start()
        shouldThrow<ConflictDetected> { none.service.apply(acc, trip, noneOpened.sessionId) }

        val failed = fixture(FakeReplans(failWith = IllegalStateException("agent down")))
        val failedOpened = failed.start()
        shouldThrow<ConflictDetected> { failed.service.apply(acc, trip, failedOpened.sessionId) }
    }

    "취소한 세션도 확정할 수 없다 — 취소가 원상복구를 보장한다(US-PLANB-08)" {
        val f = fixture()
        val opened = f.start()
        f.service.cancel(acc, trip, opened.sessionId)

        shouldThrow<ConflictDetected> { f.service.apply(acc, trip, opened.sessionId) }
        f.replans.applied shouldBe emptyList()
    }

    // 잠금 규칙 자체는 C8 소관이지만, **완료 실적이 전달되는지**는 여기서만 드러난다.
    "사용자 입력과 범위가 산출 요청에 그대로 실린다" {
        val f = fixture()
        f.start(ReplanScope.FULL_DAY)

        val cmd = f.replans.commands.single()
        cmd.fullDay shouldBe true
        cmd.targetDate shouldBe today
        cmd.reasons shouldContainExactly listOf("비가 와요")
        cmd.directives shouldContainExactly listOf("실내로")
        cmd.originLat shouldBe 33.45
    }
})
