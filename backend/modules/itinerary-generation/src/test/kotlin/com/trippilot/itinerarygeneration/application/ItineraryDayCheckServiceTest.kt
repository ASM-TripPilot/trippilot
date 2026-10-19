package com.trippilot.itinerarygeneration.application

import ch.qos.logback.classic.Level
import ch.qos.logback.classic.Logger
import ch.qos.logback.classic.spi.ILoggingEvent
import ch.qos.logback.core.read.ListAppender
import com.trippilot.itinerarygeneration.api.HoursVerdict
import com.trippilot.itinerarygeneration.domain.GenerationMode
import com.trippilot.itinerarygeneration.domain.Itinerary
import com.trippilot.itinerarygeneration.domain.ItineraryDay
import com.trippilot.itinerarygeneration.domain.ItineraryRepository
import com.trippilot.itinerarygeneration.domain.ScheduleAgentCallFailed
import com.trippilot.itinerarygeneration.domain.ScheduleAgentOutput
import com.trippilot.itinerarygeneration.domain.SolveMode
import com.trippilot.itinerarygeneration.domain.Violation
import com.trippilot.itinerarygeneration.domain.VisitSlot
import com.trippilot.placedata.api.FrozenPoiView
import com.trippilot.placedata.api.PoiSurfaceFacade
import com.trippilot.placedata.api.PoiSurfaceView
import com.trippilot.trip.api.TripFacade
import com.trippilot.trip.api.TripPeriod
import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.collections.shouldBeEmpty
import io.kotest.matchers.collections.shouldContainExactly
import io.kotest.matchers.nulls.shouldBeNull
import io.kotest.matchers.nulls.shouldNotBeNull
import io.kotest.matchers.shouldBe
import org.slf4j.LoggerFactory
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

/** 열린 트랜잭션을 센다 — AI 검증이 읽기 트랜잭션을 닫은 **뒤에** 도는지 본다(커넥션을 문 채 기다리지 않는다). */
private class TrackingTx : PlatformTransactionManager {
    var open = 0
    val readOnly = mutableListOf<Boolean>()
    override fun getTransaction(definition: TransactionDefinition?): TransactionStatus {
        open++
        readOnly += definition?.isReadOnly == true
        return SimpleTransactionStatus()
    }
    override fun commit(status: TransactionStatus) { open-- }
    override fun rollback(status: TransactionStatus) { open-- }
}

/** validate 대역 — 받은 일정과 그때 열린 트랜잭션 수를 적는다. 실패는 실물처럼 예외다. */
private class DayValidator(
    private val tx: TrackingTx,
    private val violations: List<Violation> = emptyList(),
    private val failure: RuntimeException? = null,
) : StubScheduleAgent() {
    val received = mutableListOf<ScheduleAgentOutput>()
    val openAtCall = mutableListOf<Int>()
    override fun validate(solution: ScheduleAgentOutput): List<Violation> {
        received += solution
        openAtCall += tx.open
        failure?.let { throw it }
        return violations
    }
}

/**
 * 하루 점검(T-D3-U · BR-SA-17 · domain-entities §7.1) — 장소 감지의 영업시간 재료.
 *
 * 핵심은 **모름을 OK 로 채우지 않는 것**이다: AI 모드가 가짜·보류·영업시간 원문 없음은 전부 UNKNOWN 이고,
 * 편집 때 이미 본 경고(hoursWarnedBefore)는 영업시간 문구일 때만 참이다 — 보류 중 중립 문구·이동 문구를 경고로 읽으면
 * 처음 보는 영업시간 위반이 '이미 본 경고'로 묻힌다.
 */
class ItineraryDayCheckServiceTest : StringSpec({

    val acc = UUID.randomUUID()
    val tripId = UUID.randomUUID()
    val d1 = LocalDate.parse("2026-10-20")
    val d2 = LocalDate.parse("2026-10-21")
    val poiA = UUID.randomUUID()
    val poiB = UUID.randomUUID()
    val poiC = UUID.randomUUID()
    val snapA = UUID.randomUUID()
    val clock = Clock.fixed(Instant.parse("2026-10-19T11:15:00Z"), ZoneOffset.UTC)

    val trips = object : TripFacade {
        override fun findPeriod(accountId: UUID, tripId: UUID) = if (accountId == acc) TripPeriod(d1, d2) else null
        override fun findGenerationContext(accountId: UUID, tripId: UUID) = null
    }

    fun repo(stored: Itinerary?) = object : ItineraryRepository {
        override fun save(itinerary: Itinerary) = itinerary
        override fun findById(itineraryId: UUID) = stored
        override fun findByTrip(tripId: UUID) = listOfNotNull(stored)
        override fun replaceForTrip(tripId: UUID, itinerary: Itinerary) = itinerary
        override fun replaceIfCurrent(tripId: UUID, expectedItineraryId: UUID, itinerary: Itinerary) = true
        override fun findStalePartial(updatedBefore: Instant) = emptyList<Itinerary>()
    }

    fun live(id: UUID, name: String, hours: String? = "09:00~18:00") =
        PoiSurfaceView(id, name, 33.4, 126.5, "명소", "SIGHT", hours, null, emptyList())

    fun surfaces(live: Map<UUID, PoiSurfaceView>, frozen: Map<UUID, FrozenPoiView> = emptyMap()) = object : PoiSurfaceFacade {
        override fun findSurfaces(poiIds: Collection<UUID>) = live.filterKeys { it in poiIds }
        override fun findFrozenSurfaces(poiSnapshotIds: Collection<UUID>) = frozen.filterKeys { it in poiSnapshotIds }
    }

    val names = mapOf(poiA to live(poiA, "성산일출봉"), poiB to live(poiB, "흑돼지거리"), poiC to live(poiC, "협재해수욕장", hours = null))

    fun slot(poi: UUID, order: Int, start: String, snapshot: UUID? = null, flagged: Boolean = false, reason: String? = null) =
        VisitSlot.of(
            poi, snapshot, order, LocalTime.parse(start), LocalTime.parse(start).plusHours(1),
            hasViolation = flagged, violationReason = reason,
        )

    fun itinerary(vararg days: ItineraryDay) =
        Itinerary.create(tripId, SolveMode.FULL_AI, GenerationMode.FULLY_AI, false, days.toList(), clock.instant())

    /** 이틀 일정 — d1 에 A·B, d2 에 C. 검증은 d1 만 받아야 한다. */
    val twoDays = itinerary(
        ItineraryDay.of(d1, 0, listOf(slot(poiA, 0, "10:00"), slot(poiB, 1, "12:00"))),
        ItineraryDay.of(d2, 1, listOf(slot(poiC, 0, "10:00"))),
    )

    fun service(
        stored: Itinerary? = twoDays,
        agent: (TrackingTx) -> DayValidator = { DayValidator(it) },
        mode: String = "http",
        surface: PoiSurfaceFacade = surfaces(names),
    ): Triple<ItineraryDayCheckService, DayValidator, TrackingTx> {
        val tx = TrackingTx()
        val validator = agent(tx)
        return Triple(
            ItineraryDayCheckService(trips, repo(stored), SlotSurfaceAssembler(surface), validator, tx, clock, mode),
            validator, tx,
        )
    }

    "비소유·일정 없음·날짜 없음은 null 이다 — AI 를 부르지 않는다" {
        val (svc, ai) = service()
        svc.checkDay(UUID.randomUUID(), tripId, d1).shouldBeNull()
        service(stored = null).first.checkDay(acc, tripId, d1).shouldBeNull()
        svc.checkDay(acc, tripId, d2.plusDays(1)).shouldBeNull()
        ai.received.shouldBeEmpty()
    }

    "빈 날은 AI 를 부르지 않는다 — 볼 슬롯이 없다" {
        val (svc, ai) = service(stored = itinerary(ItineraryDay.of(d1, 0, emptyList())))

        val day = svc.checkDay(acc, tripId, d1).shouldNotBeNull()

        day.slots.shouldBeEmpty()
        day.judged shouldBe true
        ai.received.shouldBeEmpty()
    }

    "그 날 하루만 검증한다 — 읽기 트랜잭션을 닫은 뒤에 부르고, 다른 날 슬롯은 보내지 않는다" {
        val (svc, ai, tx) = service()

        val day = svc.checkDay(acc, tripId, d1).shouldNotBeNull()

        ai.received.single().days.map { it.date } shouldContainExactly listOf(d1)
        ai.received.single().days.single().slots.map { it.poiId } shouldContainExactly listOf(poiA, poiB)
        ai.openAtCall shouldContainExactly listOf(0)
        tx.readOnly shouldContainExactly listOf(true)
        day.judged shouldBe true
        day.slots.map { it.slotKey } shouldContainExactly listOf("$d1#$poiA", "$d1#$poiB")
        day.slots.map { it.startAt } shouldContainExactly listOf(LocalTime.parse("10:00"), LocalTime.parse("12:00"))
        day.slots.map { it.hours } shouldContainExactly listOf(HoursVerdict.OK, HoursVerdict.OK)
        day.slots.map { it.reasonCode } shouldContainExactly listOf(null, null) // 경계에 하위 코드가 아직 없다(PR-H1)
    }

    "HC1 위반은 그 슬롯만 VIOLATED — 위치 없는 HC1·보내지 않은 날을 가리키는 HC1·HC2 는 붙이지 않는다" {
        val (svc) = service(
            agent = {
                DayValidator(
                    it,
                    violations = listOf(
                        Violation("HC1", 0, 1, "영업시간 밖: 543~618"),
                        Violation("HC1", null, null, "위치 모름"),
                        Violation("HC1", 1, 0, "하루만 보냈는데 둘째 날"),
                        Violation("HC2", 0, 0, "이동 54분 필요"),
                    ),
                )
            },
        )

        val day = svc.checkDay(acc, tripId, d1).shouldNotBeNull()

        day.slots.map { it.hours } shouldContainExactly listOf(HoursVerdict.OK, HoursVerdict.VIOLATED)
    }

    "상징 이름(OPENING_HOURS)도 영업시간 위반이다 — 문구 번역과 같은 어휘" {
        val (svc) = service(agent = { DayValidator(it, violations = listOf(Violation("opening_hours", 0, 0, null))) })

        svc.checkDay(acc, tripId, d1).shouldNotBeNull().slots.first().hours shouldBe HoursVerdict.VIOLATED
    }

    "AI 모드가 http 가 아니면 부르지 않고 UNKNOWN 이다 — 가짜 검증의 빈 목록은 '깨끗함'이 아니다" {
        val (svc, ai) = service(mode = "fake")

        val day = svc.checkDay(acc, tripId, d1).shouldNotBeNull()

        ai.received.shouldBeEmpty()
        day.judged shouldBe false
        day.slots.map { it.hours } shouldContainExactly listOf(HoursVerdict.UNKNOWN, HoursVerdict.UNKNOWN)
    }

    "모드 값은 대소문자를 가리지 않는다 — 어댑터를 켜는 조건과 같다" {
        val (svc, ai) = service(mode = "HTTP")

        svc.checkDay(acc, tripId, d1).shouldNotBeNull().judged shouldBe true
        ai.received.size shouldBe 1
    }

    "보류(불통·5xx·시한)면 judged=false 이고 UNKNOWN 이다 — WARN 으로 드러낸다" {
        val appender = ListAppender<ILoggingEvent>().apply { start() }
        val logger = LoggerFactory.getLogger(Revalidation::class.java) as Logger
        logger.addAppender(appender)
        val day = try {
            service(agent = { DayValidator(it, failure = ScheduleAgentCallFailed(null, retryable = true, message = "AI 호출 실패")) })
                .first.checkDay(acc, tripId, d1)
        } finally {
            logger.detachAppender(appender)
        }

        day.shouldNotBeNull().judged shouldBe false
        day.slots.map { it.hours } shouldContainExactly listOf(HoursVerdict.UNKNOWN, HoursVerdict.UNKNOWN)
        appender.list.count { it.level == Level.WARN } shouldBe 1
    }

    "영업시간 원문이 없으면 UNKNOWN 이다 — 원문 없이 낸 '위반 없음'은 판정이 아니다" {
        val (svc) = service()

        val day = svc.checkDay(acc, tripId, d2).shouldNotBeNull()

        day.judged shouldBe true
        day.slots.single().hours shouldBe HoursVerdict.UNKNOWN
    }

    "표면이 없는 슬롯은 이름 null · UNKNOWN — 이름을 지어내지 않는다" {
        val (svc) = service(surface = surfaces(emptyMap()))

        val day = svc.checkDay(acc, tripId, d1).shouldNotBeNull()

        day.slots.map { it.nameKo } shouldContainExactly listOf(null, null)
        day.slots.map { it.hours } shouldContainExactly listOf(HoursVerdict.UNKNOWN, HoursVerdict.UNKNOWN)
    }

    "확정 슬롯의 이름은 동결값이다 — 원본이 개명돼도 확정 당시 이름(INV-U1-03)" {
        val frozen = FrozenPoiView(snapA, poiA, "성산일출봉", 33.4, 126.9, "명소", "SIGHT")
        val renamed = names + (poiA to live(poiA, "이름이 바뀐 곳"))
        val confirmed = itinerary(ItineraryDay.of(d1, 0, listOf(slot(poiA, 0, "10:00", snapshot = snapA))))
        val (svc) = service(stored = confirmed, surface = surfaces(renamed, mapOf(snapA to frozen)))

        svc.checkDay(acc, tripId, d1).shouldNotBeNull().slots.single().nameKo shouldBe "성산일출봉"
    }

    "이미 본 경고는 영업시간 문구일 때만이다 — 이동 문구·보류 중 중립 문구·표시 없는 사유는 거짓" {
        val day1 = ItineraryDay.of(
            d1, 0,
            listOf(
                slot(poiA, 0, "09:00", flagged = true, reason = ViolationText.OPENING_HOURS_PHRASE),
                slot(poiB, 1, "11:00", flagged = true, reason = "앞 장소에서 이동할 시간이 빠듯해요 · ${ViolationText.OPENING_HOURS_PHRASE}"),
                slot(poiC, 2, "13:00", flagged = true, reason = "앞 장소에서 이동할 시간이 빠듯해요"),
                slot(UUID.randomUUID(), 3, "15:00", flagged = true, reason = PriorViolations.STALE_REASON),
                slot(UUID.randomUUID(), 4, "17:00", flagged = false, reason = ViolationText.OPENING_HOURS_PHRASE),
            ),
        )
        val (svc) = service(stored = itinerary(day1))

        svc.checkDay(acc, tripId, d1).shouldNotBeNull().slots.map { it.hoursWarnedBefore } shouldContainExactly
            listOf(true, true, false, false, false)
    }
})
