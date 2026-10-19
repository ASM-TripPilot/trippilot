package com.trippilot.recalculation.application

import com.trippilot.itinerarygeneration.api.ItineraryFacade
import com.trippilot.itinerarygeneration.api.ItineraryPlanFacade
import com.trippilot.itinerarygeneration.api.ItineraryRef
import com.trippilot.itinerarygeneration.api.PlannedPlaceView
import com.trippilot.itinerarygeneration.api.PlannedSlotView
import com.trippilot.placedata.api.FrozenPoiView
import com.trippilot.placedata.api.PoiSurfaceFacade
import com.trippilot.placedata.api.PoiSurfaceView
import com.trippilot.planbdetection.api.TriggerLookupFacade
import com.trippilot.planbdetection.api.TriggerRef
import com.trippilot.recalculation.domain.OriginKind
import com.trippilot.recalculation.domain.ReplanOrigin
import com.trippilot.recalculation.domain.ReplanScope
import com.trippilot.recalculation.domain.ReplanSessionRepository
import com.trippilot.savedaccommodation.api.BaseAnchorFacade
import com.trippilot.savedaccommodation.api.DayAnchorView
import com.trippilot.trip.api.TripFacade
import com.trippilot.trip.api.TripPeriod
import java.time.Clock
import java.time.Duration
import java.time.Instant
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.LocalTime
import java.time.ZoneId
import java.time.ZoneOffset
import java.util.UUID

internal val KST: ZoneId = ZoneId.of("Asia/Seoul")

internal fun kst(date: LocalDate, hhmm: String): Instant = LocalDateTime.of(date, LocalTime.parse(hhmm)).atZone(KST).toInstant()

/** 흐르는 시계 — 낡음·30분 규칙·하루 상한이 시각에 기대므로 테스트가 시각을 정한다(벽시계 의존 금지). */
internal class MutableClock(var now: Instant) : Clock() {
    override fun getZone(): ZoneId = ZoneOffset.UTC
    override fun withZone(zone: ZoneId?): Clock = this
    override fun instant(): Instant = now
    fun advance(by: Duration) { now = now.plus(by) }
}

/** 트리거 조회 대역(C9 api) — 여행 범위로 좁혀 찾는다(다른 여행 트리거는 null). */
internal class FakeTriggerLookup : TriggerLookupFacade {
    private val refs = mutableMapOf<Pair<UUID, UUID>, TriggerRef>()

    fun add(tripId: UUID, date: LocalDate, kind: String = "WEATHER", id: UUID = UUID.randomUUID()): UUID {
        refs[tripId to id] = TriggerRef(kind, "ACTIVE", date, if (kind == "WEATHER") "FULL_DAY" else "PARTIAL_SLOTS", id)
        return id
    }

    override fun find(tripId: UUID, triggerId: UUID): TriggerRef? = refs[tripId to triggerId]
}

/**
 * 여행·일정·계획 슬롯 대역 — 한 계정이 여러 여행을 갖는다(하루 전체 상한을 재려면 여행이 많아야 한다).
 * 남의 계정이면 없는 것으로 답한다(404 은닉은 서비스 몫).
 */
internal class FakeTrips(val accountId: UUID = UUID.randomUUID()) : TripFacade, ItineraryFacade, ItineraryPlanFacade {
    class Trip(val period: TripPeriod, val itineraryId: UUID, val dates: List<LocalDate>, var slots: List<PlannedSlotView>)

    val trips = linkedMapOf<UUID, Trip>()

    fun add(
        start: LocalDate,
        end: LocalDate,
        dates: List<LocalDate> = generateSequence(start) { it.plusDays(1) }.takeWhile { it <= end }.toList(),
        id: UUID = UUID.randomUUID(),
    ): UUID {
        trips[id] = Trip(TripPeriod(start, end), UUID.randomUUID(), dates, emptyList())
        return id
    }

    private fun own(accountId: UUID, tripId: UUID) = trips[tripId]?.takeIf { accountId == this.accountId }

    override fun findPeriod(accountId: UUID, tripId: UUID) = own(accountId, tripId)?.period
    override fun findGenerationContext(accountId: UUID, tripId: UUID) = null
    override fun findCurrent(accountId: UUID, tripId: UUID) = own(accountId, tripId)?.let {
        ItineraryRef(it.itineraryId, "PLANNED", "COMPLETE", it.dates, it.slots.map { s -> s.slotKey })
    }
    override fun findPlanSlots(accountId: UUID, tripId: UUID) = own(accountId, tripId)?.slots.orEmpty()
    override fun findPlannedPlaces(accountId: UUID, tripId: UUID) = emptyMap<LocalDate, List<PlannedPlaceView>>()
}

/**
 * 재계획 서비스 조립(대역 위) — 진입·선계산·적용 스펙이 함께 쓴다. 저장소는 DB 의 부분 유니크를 흉내 내는
 * [InMemoryReplanSessions] 라 "열린 세션 ≤ 1"·"트리거당 1개"가 여기서도 반증 가능하다.
 */
internal class RecalcFixture(
    on: LocalDate,
    now: String,
    val horizon: ReplanHorizon = ReplanHorizon.TODAY,
    start: LocalDate = on.minusDays(1),
    end: LocalDate = on.plusDays(1),
) {
    val clock = MutableClock(kst(on, now))
    val trips = FakeTrips()
    val acc = trips.accountId
    val sessions = InMemoryReplanSessions()
    val triggers = FakeTriggerLookup()
    val replans = FakeReplans()
    val completed = mutableSetOf<String>()
    val archive = FakeArchive(completed)
    val events = CapturingReplanEvents()
    val legalLogs = CapturingLegalLogs()
    val solver = ReplanSolver(sessions, archive, replans, NOOP_TX, clock)
    var repository: ReplanSessionRepository = sessions
    val tripId = trips.add(start, end)

    fun service(h: ReplanHorizon = horizon) = ReplanSessionService(
        trips, trips, repository, OriginResolver(NO_ANCHORS), archive, NO_SURFACES, solver, replans,
        FakeLocationConsents(), legalLogs, FakeTripPurgeScope(), events, clock, triggers, trips, ReplanProperties(h),
    )

    fun prepare(triggerId: UUID, tripId: UUID = this.tripId) = service().prepare(
        PrepareReplan(acc, tripId, triggerId, listOf("WEATHER"), listOf("AVOID_OUTDOOR"), emptyList()),
    )

    fun startUser(
        triggerId: UUID? = null,
        target: LocalDate? = null,
        scope: ReplanScope = ReplanScope.PARTIAL_SLOTS,
        tripId: UUID = this.tripId,
    ) = service().start(
        acc, tripId,
        StartReplan(
            scope, target, ReplanOrigin(OriginKind.GPS, 33.45, 126.56),
            listOf("WEATHER"), emptyList(), null, emptyList(), triggerId,
        ),
    )
}

internal fun plannedSlot(date: LocalDate, poiId: UUID, start: String, end: String) = PlannedSlotView(
    slotKey = "$date#$poiId", date = date, poiId = poiId, orderIndex = 0,
    startAt = LocalTime.parse(start), endAt = LocalTime.parse(end), isFixed = false, endsNextDay = false, hasViolation = false,
)

internal val NO_ANCHORS = object : BaseAnchorFacade {
    override fun findStayNightAnchors(tripId: UUID, startDate: LocalDate, endDate: LocalDate) = emptyList<DayAnchorView>()
}

/** 계획 슬롯이 없는 일정 — 사용자 세션만 다루는 스펙은 낡음 재료를 읽지 않는다. */
internal val NO_PLANS = object : ItineraryPlanFacade {
    override fun findPlanSlots(accountId: UUID, tripId: UUID) = emptyList<PlannedSlotView>()
    override fun findPlannedPlaces(accountId: UUID, tripId: UUID) = emptyMap<LocalDate, List<PlannedPlaceView>>()
}

internal val NO_SURFACES = object : PoiSurfaceFacade {
    override fun findSurfaces(poiIds: Collection<UUID>) = emptyMap<UUID, PoiSurfaceView>()
    override fun findFrozenSurfaces(poiSnapshotIds: Collection<UUID>) = emptyMap<UUID, FrozenPoiView>()
}
