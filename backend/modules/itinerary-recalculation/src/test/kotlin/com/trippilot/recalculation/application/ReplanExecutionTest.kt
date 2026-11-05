package com.trippilot.recalculation.application

import com.trippilot.core.error.ConflictDetected
import com.trippilot.itinerarygeneration.api.ItineraryFacade
import com.trippilot.itinerarygeneration.api.ItineraryRef
import com.trippilot.itinerarygeneration.api.DeferredPlace
import com.trippilot.itinerarygeneration.api.PriorReplan
import com.trippilot.itinerarygeneration.api.ReplanProposal
import com.trippilot.recalculation.adapter.`in`.web.DeferredPlaceResponse
import com.trippilot.recalculation.adapter.`in`.web.ReplanSessionResponse
import com.trippilot.placedata.api.FrozenPoiView
import com.trippilot.savedaccommodation.api.BaseAnchorFacade
import com.trippilot.savedaccommodation.api.DayAnchorView
import com.trippilot.placedata.api.PoiSurfaceFacade
import com.trippilot.placedata.api.PoiSurfaceView
import com.trippilot.recalculation.api.event.ItineraryRecalculated
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
import io.kotest.matchers.collections.shouldContainExactlyInAnyOrder
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
    override fun findOpenByTripForUpdate(tripId: UUID) = store.values.firstOrNull { it.tripId == tripId && it.isOpen }
    override fun findSystemByTrigger(triggerId: UUID) = store.values.systemByTrigger(triggerId)
    override fun findLatestSystem(tripId: UUID, targetDate: LocalDate) = store.values.latestSystem(tripId, targetDate)
    override fun countSystemSince(tripId: UUID?, since: Instant) = store.values.countSystemSince(tripId, since)
    override fun findAppliedOn(tripId: UUID, targetDate: LocalDate) = store.values.appliedOn(tripId, targetDate)
    override fun purgeOrigins(tripIds: List<UUID>): Int {
        val hit = store.values.filter { it.tripId in tripIds && it.origin.kind in setOf(OriginKind.GPS, OriginKind.MANUAL) }
        hit.forEach { store[it.sessionId] = it.copy(origin = ReplanOrigin(OriginKind.PURGED, null, null)) }
        return hit.size
    }
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
            ItineraryRef(FakeReplans.ITINERARY_ID, "PLANNED", "COMPLETE", listOf(today, today.plusDays(1)), emptyList())
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
        /** 트리거 진입은 그 트리거의 날짜로 강제된다(BR-SA-20) — 진입하는 트리거는 여기 있어야 한다. */
        val triggers = FakeTriggerLookup()
        lateinit var service: ReplanSessionService
    }

    fun fixture(replans: FakeReplans = FakeReplans(), archive: FakeArchive = FakeArchive()): Fixture = Fixture(replans).apply {
        service = ReplanSessionService(
            trips, itineraries, sessions, OriginResolver(noAnchors), archive, surfaces,
            ReplanSolver(sessions, archive, replans, NOOP_TX, clock), replans, FakeLocationConsents(), CapturingLegalLogs(), FakeTripPurgeScope(), events, clock,
            triggers, NO_PLANS, ReplanProperties(),
        )
    }

    fun Fixture.start(
        scope: ReplanScope = ReplanScope.PARTIAL_SLOTS,
        targetDate: LocalDate? = null,
        excludedPoiIds: List<UUID> = emptyList(),
    ) = service.start(
        acc, trip,
        StartReplan(
            triggerId = null, scope = scope, targetDate = targetDate, origin = ReplanOrigin(OriginKind.GPS, 33.45, 126.56),
            reasons = listOf("비가 와요"), directives = listOf("실내로"), freeText = null, excludedPoiIds = excludedPoiIds,
        ),
    )

    // 종전에는 솔버가 `fromInstant` 로 '오늘'을 다시 계산해 **오늘만** 다시 짤 수 있었다(TRIP-1182).
    // 이 단언이 깨지면 사용자가 모레를 골라도 오늘 하루가 다시 짜인다.
    "산출 요청은 세션의 대상 일자로 나간다" {
        val f = fixture()
        val tomorrow = today.plusDays(1)

        f.start(scope = ReplanScope.FULL_DAY, targetDate = tomorrow)

        f.replans.commands.single().targetDate shouldBe tomorrow
    }

    "대상 일자를 생략하면 산출도 오늘로 나간다 — 종전 동작이 기본값이다" {
        val f = fixture()

        f.start()

        f.replans.commands.single().targetDate shouldBe today
    }

    // U4 BR-U4-17 개정(2026-11-01) — 앱은 수동 진입에서 빈 제외 목록을 보낸다. 서버가 안 채우면 그날 건너뛴 곳이
    // 새 일정에 다시 들어와, 같은 슬롯 키의 건너뜀 기록과 부딪혀 [도착]이 영원히 409 인 칸이 된다.
    "그날 건너뛴 곳은 앱이 안 보내도 산출 요청의 제외 목록에 실린다" {
        val skipped = UUID.randomUUID()
        val f = fixture(archive = FakeArchive(skippedPois = mapOf(today to setOf(skipped))))

        f.start()

        f.replans.commands.single().excludedPoiIds shouldContainExactly listOf(skipped)
    }

    "앱이 보낸 제외와 합쳐진다 — 겹치면 한 번만" {
        val sent = UUID.randomUUID()
        val skipped = UUID.randomUUID()
        val f = fixture(archive = FakeArchive(skippedPois = mapOf(today to setOf(skipped, sent))))

        f.start(excludedPoiIds = listOf(sent))

        f.replans.commands.single().excludedPoiIds shouldContainExactlyInAnyOrder listOf(sent, skipped)
    }

    // 다른 날 건너뛴 같은 곳은 슬롯 키가 달라 충돌하지 않는다 — 빼면 그날 갈 수 있는 곳을 괜히 잃는다.
    "다른 날짜의 건너뜀은 섞이지 않는다 — 대상 일자로 묻는다" {
        val skippedToday = UUID.randomUUID()
        val skippedTomorrow = UUID.randomUUID()
        val tomorrow = today.plusDays(1)
        val f = fixture(archive = FakeArchive(skippedPois = mapOf(today to setOf(skippedToday), tomorrow to setOf(skippedTomorrow))))

        f.start(scope = ReplanScope.FULL_DAY, targetDate = tomorrow)

        f.replans.commands.single().excludedPoiIds shouldContainExactly listOf(skippedTomorrow)
        // 고정 잠금을 풀 대상도 같은 날짜로만 가른다 — 오늘 건너뛴 고정이 내일 일정에서 풀리면 안 된다(TRIP-1711).
        f.replans.commands.single().skippedPoiIds shouldContainExactly listOf(skippedTomorrow)
    }

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
                triggerId = f.triggers.add(trip, today), targetDate = null, scope = ReplanScope.PARTIAL_SLOTS,
                origin = ReplanOrigin(OriginKind.GPS, 33.45, 126.56),
                reasons = listOf("비가 와요"), directives = listOf("실내로"),
                freeText = null, excludedPoiIds = emptyList(),
            ),
        )

        f.service.apply(acc, trip, opened.sessionId)

        f.replans.appliedReasons.single() shouldBe "자동 감지 · 비가 와요 · 실내로"
    }

    // 트리거 소비(C9)가 날짜까지 대조한다 — 내일 트리거로 연 재계획이 오늘을 다시 짜면 그 트리거를 닫지 않는다.
    "확정 사건은 근거 트리거와 다시 짠 날을 싣는다" {
        val f = fixture()
        val triggerId = f.triggers.add(trip, today)
        val opened = f.service.start(
            acc, trip,
            StartReplan(
                triggerId = triggerId, targetDate = null, scope = ReplanScope.PARTIAL_SLOTS,
                origin = ReplanOrigin(OriginKind.GPS, 33.45, 126.56),
                reasons = listOf("비가 와요"), directives = emptyList(), freeText = null, excludedPoiIds = emptyList(),
            ),
        )

        f.service.apply(acc, trip, opened.sessionId)

        val event = f.events.published.single() as ItineraryRecalculated
        event.triggerId shouldBe triggerId.toString()
        event.targetDate shouldBe today.toString()
    }

    "수동 재계획 확정 사건에는 트리거가 없다 — 소비할 것이 없다" {
        val f = fixture()
        val opened = f.start()

        f.service.apply(acc, trip, opened.sessionId)

        (f.events.published.single() as ItineraryRecalculated).triggerId shouldBe null
    }

    // 사유를 하나도 안 고르고 확정할 수 있다 — 그때도 빈 칸으로 남기지 않는다.
    "사유를 하나도 안 골라도 최소 문구는 남는다" {
        val f = fixture()
        val opened = f.service.start(
            acc, trip,
            StartReplan(
                triggerId = null, targetDate = null, scope = ReplanScope.PARTIAL_SLOTS,
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
                triggerId = null, targetDate = null, scope = ReplanScope.PARTIAL_SLOTS,
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

    // ── 앞 요청 기억(F-8) — 같은 날 반영된 재계획이 요청해서 넣은 곳을 다음 재계획에 싣는다 ─────────────

    /** 그 날 반영된 세션 하나 — 초안에 AI 가 돌려준 요청한 곳([requested], null = 그 칸을 모르던 AI)을 담는다. */
    fun applied(
        requested: List<UUID>?, freeText: String, closedAt: String, target: LocalDate = today, tripId: UUID = trip,
        status: ReplanStatus = ReplanStatus.APPLIED, revertedAt: String? = null,
    ): ReplanSession {
        val at = Instant.parse(closedAt)
        return ReplanSession.start(
            tripId, FakeReplans.ITINERARY_ID, null, ReplanScope.FULL_DAY, target, at, ReplanOrigin(OriginKind.GPS, 33.45, 126.56),
            emptyList(), emptyList(), freeText, emptyList(), at.minusSeconds(60),
        ).copy(
            status = status, closedAt = at, revertedAt = revertedAt?.let(Instant::parse),
            draft = FakeReplans.sampleProposal(target).copy(requestedPoiIds = requested).toMap(),
        )
    }

    "앞 요청은 같은 날 반영·안 되돌린 세션 중 요청한 곳을 저장한 것만 싣는다 — 최근 반영 먼저" {
        val club = UUID.randomUUID()
        val forest = UUID.randomUUID()
        val f = fixture()
        listOf(
            applied(listOf(club), "클럽 넣어줘", "2026-08-11T01:00:00Z"),
            applied(listOf(forest), "숲 산책로 꼭", "2026-08-11T02:00:00Z"),
            // 새 AI 가 "요청한 곳 없음"이라 답한 회차도 싣는다 — 그래야 AI 가 같은 이력을 사유로 다시 읽어 더하지 않는다
            applied(emptyList(), "오늘 남은 일정 다시 맞춰줘", "2026-08-11T01:30:00Z"),
            applied(listOf(UUID.randomUUID()), "카페 넣어줘", "2026-08-11T02:20:00Z", revertedAt = "2026-08-11T02:30:00Z"), // 되돌림
            applied(null, "옛 AI 의 회차", "2026-08-11T00:30:00Z"),                                                         // 칸 없음
            applied(listOf(UUID.randomUUID()), "내일 것", "2026-08-11T02:40:00Z", target = today.plusDays(1)),               // 다른 날
            applied(listOf(UUID.randomUUID()), "남의 여행", "2026-08-11T02:50:00Z", tripId = UUID.randomUUID()),             // 다른 여행
            applied(listOf(UUID.randomUUID()), "취소한 회차", "2026-08-11T02:55:00Z", status = ReplanStatus.CANCELED),        // 반영 안 됨
        ).forEach { f.sessions.save(it) }

        f.start()

        f.replans.commands.single().priorRequests shouldContainExactly listOf(
            PriorReplan("숲 산책로 꼭", listOf(forest)),
            PriorReplan("오늘 남은 일정 다시 맞춰줘", emptyList()),
            PriorReplan("클럽 넣어줘", listOf(club)),
        )
    }

    /**
     * **배포 순서 가드(앞으로 가는 쪽).** AI 요청 스키마는 모르는 키를 422 로 거절한다 — 요청한 곳을 저장한 세션이 없으면(전부 옛 AI 의
     * 응답·이 기능 이전 반영) 아무것도 싣지 않고, 어댑터가 빈 칸을 키째 뺀다(`HttpScheduleAgentAdapterTest`). 새 AI 가 응답해야 그 칸이
     * 생긴다. 옛·새 AI 파드가 섞인 창(롤링·롤백)은 어댑터가 422 에서 이 칸을 빼고 한 번 다시 불러 닫는다.
     */
    "요청한 곳을 저장한 세션이 없으면 앞 요청을 싣지 않는다 — 그 칸을 모르는 AI 에 보내지 않는다" {
        val f = fixture()
        f.sessions.save(applied(null, "클럽 넣어줘", "2026-08-11T01:00:00Z"))
        f.sessions.save(applied(null, "숲 산책로 꼭", "2026-08-11T02:00:00Z"))

        f.start()

        f.replans.commands.single().priorRequests shouldBe emptyList()
    }

    /**
     * AI 는 맨 앞(가장 최근 반영) 회차의 기억만 읽는다 — 응답이 이미 사슬이라서다. 가장 최근 회차가 그 칸을 모르면(옛 AI 파드가 답했다)
     * 그 앞 회차들을 싣지 않는다: 앞 사슬은 칸 없는 회차가 잊게 한 곳("클럽은 빼줘")을 몰라, 실으면 잊은 곳이 되살아난다. 그때 AI 는
     * 변경 이력 근사(F-5)로 기억한다.
     */
    "가장 최근 반영 세션이 요청한 곳을 모르면 그 앞 회차의 기억도 싣지 않는다" {
        val f = fixture()
        f.sessions.save(applied(listOf(UUID.randomUUID()), "클럽 넣어줘", "2026-08-11T01:00:00Z"))
        f.sessions.save(applied(null, "클럽은 빼줘", "2026-08-11T02:00:00Z"))

        f.start()

        f.replans.commands.single().priorRequests shouldBe emptyList()
    }

    "반영한 재계획이 요청한 곳이 다음 재계획의 앞 요청이 된다 — 되돌리면 빠진다" {
        val club = UUID.randomUUID()
        val f = fixture(FakeReplans(proposal = FakeReplans.sampleProposal().copy(requestedPoiIds = listOf(club))))
        val first = f.start()
        f.service.apply(acc, trip, first.sessionId)

        f.start()
        f.replans.commands.last().priorRequests shouldBe listOf(PriorReplan("비가 와요 · 실내로", listOf(club)))

        f.sessions.save(f.sessions.findById(first.sessionId)!!.copy(revertedAt = clock.instant()))
        f.start()
        f.replans.commands.last().priorRequests shouldBe emptyList()
    }

    // F-7 — 앱이 세션 응답의 이 칸으로 "‘서울광장’은 2일차 요청이라 이번엔 넣지 않았어요 [2일차에 넣어 다시 짜기]"를 그린다.
    "초안이 미룬 갈 곳이 세션 응답에 실린다 — 반영 뒤에도" {
        val later = UUID.randomUUID()
        val deferred = DeferredPlace(later, "서울광장", today.plusDays(1))
        val f = fixture(FakeReplans(proposal = FakeReplans.sampleProposal().copy(deferredPlaces = listOf(deferred))))
        val opened = f.start()

        val drafted = f.service.view(acc, f.sessions.findById(opened.sessionId)!!)
        drafted.deferredPlaces shouldBe listOf(deferred)
        ReplanSessionResponse.from(drafted).deferredPlaces shouldBe listOf(DeferredPlaceResponse(later, "서울광장", today.plusDays(1)))
        f.service.view(acc, f.service.apply(acc, trip, opened.sessionId)).deferredPlaces shouldBe listOf(deferred)
        f.service.view(acc, applied(null, "옛 초안", "2026-08-11T01:00:00Z")).deferredPlaces shouldBe emptyList()
    }
})
