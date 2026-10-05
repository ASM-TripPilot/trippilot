package com.trippilot.itinerarygeneration.application

import com.trippilot.core.error.ConflictDetected
import com.trippilot.core.error.ResourceNotFound
import com.trippilot.itinerarygeneration.domain.GenerationMode
import com.trippilot.itinerarygeneration.domain.RejectedPoi
import com.trippilot.itinerarygeneration.domain.Itinerary
import com.trippilot.itinerarygeneration.domain.RevisionKind
import com.trippilot.itinerarygeneration.domain.RevisionActor
import com.trippilot.itinerarygeneration.domain.NewRevision
import com.trippilot.itinerarygeneration.domain.ItineraryRevisionRepository
import com.trippilot.itinerarygeneration.domain.ItineraryRevision
import com.trippilot.itinerarygeneration.domain.ItineraryRevisionSummary
import com.trippilot.changelog.api.ChangeSourceType
import com.trippilot.itinerarygeneration.domain.ItineraryStatus
import com.trippilot.itinerarygeneration.domain.GenerationState
import com.trippilot.itinerarygeneration.domain.CandidatesSummary
import com.trippilot.itinerarygeneration.domain.ItineraryDay
import com.trippilot.itinerarygeneration.domain.ItineraryRepository
import com.trippilot.itinerarygeneration.domain.RepairResult
import com.trippilot.itinerarygeneration.domain.ScheduleAgentInput
import com.trippilot.itinerarygeneration.domain.ScheduleAgentOutput
import com.trippilot.itinerarygeneration.domain.SlotExplanations
import com.trippilot.itinerarygeneration.domain.ScheduleAgentPort
import com.trippilot.itinerarygeneration.domain.SolveMode
import com.trippilot.itinerarygeneration.domain.UnplacedMustVisit
import com.trippilot.itinerarygeneration.domain.UnplacedReason
import com.trippilot.itinerarygeneration.domain.VisitSlot
import com.trippilot.itinerarygeneration.domain.Violation
import com.trippilot.trip.api.TripFacade
import com.trippilot.trip.api.TripGenerationContext
import com.trippilot.trip.api.TripPeriod
import io.kotest.property.Arb
import io.kotest.property.arbitrary.shuffle
import io.kotest.property.checkAll
import io.kotest.assertions.throwables.shouldThrow
import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.shouldBe
import io.kotest.matchers.shouldNotBe
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

private class EditFakeItineraries : ItineraryRepository {
    val store = mutableListOf<Itinerary>()
    override fun save(itinerary: Itinerary) = itinerary.also { store.removeAll { s -> s.itineraryId == it.itineraryId }; store += it }
    override fun findById(itineraryId: UUID) = store.firstOrNull { it.itineraryId == itineraryId }
    override fun findByTrip(tripId: UUID) = store.filter { it.tripId == tripId }
    override fun replaceForTrip(tripId: UUID, itinerary: Itinerary) = itinerary.also { store.removeAll { s -> s.tripId == tripId }; store += it }
    override fun replaceIfCurrent(tripId: UUID, expectedItineraryId: UUID, itinerary: Itinerary): Boolean {
        replaceForTrip(tripId, itinerary)
        return true
    }
    override fun findStalePartial(updatedBefore: java.time.Instant): List<Itinerary> = emptyList()

}

private val NOOP_TX = object : PlatformTransactionManager {
    override fun getTransaction(definition: TransactionDefinition?): TransactionStatus = SimpleTransactionStatus()
    override fun commit(status: TransactionStatus) {}
    override fun rollback(status: TransactionStatus) {}
}

/**
 * validate 는 주입된 위반을 반환(Fake). repair 는 기본 **수리 불가** — 장소 구성이 바뀐 편집이 종전
 * validate 경로를 그대로 타게 해 기존 단언을 지킨다. 수리 경로는 [repairWith] 로 주입한다.
 */
private class EditFakeAgent(
    private val violations: List<Violation> = emptyList(),
    private val failure: RuntimeException? = null, // AI 장애 재현
    private val repairWith: (ScheduleAgentOutput) -> RepairResult = { RepairResult(it, emptyList(), unrepairable = true) },
) : StubScheduleAgent() {
    var validateCalls = 0
    var repairCalls = 0
    override fun generate(input: ScheduleAgentInput): ScheduleAgentOutput = throw NotImplementedError()
    override fun validate(solution: ScheduleAgentOutput): List<Violation> {
        validateCalls++
        return failure?.let { throw it } ?: violations
    }
    override fun repair(solution: ScheduleAgentOutput, violations: List<Violation>): RepairResult {
        repairCalls++
        failure?.let { throw it }
        return repairWith(solution)
    }
    override fun explanations(tripId: UUID, solution: ScheduleAgentOutput): SlotExplanations = SlotExplanations()
}

/** 편집 — 전체 교체, 비차단 재검증(위반→hasViolation), 확정 409, 미소유·없음 404. */
/** 롤백 요청을 관찰하는 tx 매니저 — 이력 기록이 편집과 **같은 트랜잭션**인지 확인하는 데 쓴다. */
private class RecordingTx : PlatformTransactionManager {
    var rolledBack = false
    override fun getTransaction(definition: TransactionDefinition?): TransactionStatus = SimpleTransactionStatus()
    override fun commit(status: TransactionStatus) {}
    override fun rollback(status: TransactionStatus) { rolledBack = true }
}

/** 리비전 기록을 관찰하는 인메모리 저장소 — 실제 영속·seq 는 IT 가 본다. */
private class FakeRevisions : ItineraryRevisionRepository {
    val appended = mutableListOf<NewRevision>()
    var failOnAppend = false
    override fun append(revision: NewRevision): ItineraryRevision {
        if (failOnAppend) throw RuntimeException("revision store down")
        appended += revision
        return ItineraryRevision(
            UUID.randomUUID(), revision.tripId, revision.itineraryId, appended.size, revision.actor, revision.kind,
            revision.summary, revision.detail, revision.snapshot, revision.createdAt,
        )
    }
    override fun findSummaries(tripId: UUID, limit: Int) = appended.mapIndexed { i, r ->
        ItineraryRevisionSummary(UUID.randomUUID(), i + 1, r.actor, r.kind, r.summary, r.detail, r.createdAt)
    }.takeLast(limit).reversed()
    override fun existsForTrip(tripId: UUID) = appended.isNotEmpty()
    override fun findById(revisionId: UUID): ItineraryRevision? = null
}

class EditItineraryServiceTest : StringSpec({

    fun revisionSvc(repo: FakeRevisions, itineraries: ItineraryRepository, tx: PlatformTransactionManager, clock: Clock) =
        ItineraryRevisionService(repo, itineraries, object : TripFacade {
            override fun findPeriod(accountId: UUID, tripId: UUID) =
                TripPeriod(LocalDate.parse("2026-08-01"), LocalDate.parse("2026-08-01"))
            override fun findGenerationContext(accountId: UUID, tripId: UUID) = null
        }, NoopValidateAgent(), tx, clock)

    val clock = Clock.fixed(Instant.parse("2026-08-06T00:00:00Z"), ZoneOffset.UTC)
    val acc = UUID.randomUUID()
    val tripId = UUID.randomUUID()
    val day = LocalDate.parse("2026-08-01")
    val poiA = UUID.randomUUID()
    val poiB = UUID.randomUUID()

    fun trips(owned: Boolean) = object : TripFacade {
        override fun findPeriod(accountId: UUID, tripId: UUID) =
            if (owned && accountId == acc) TripPeriod(day, day.plusDays(1)) else null
        override fun findGenerationContext(accountId: UUID, tripId: UUID): TripGenerationContext? = null
    }

    fun current(status: (Itinerary) -> Itinerary = { it }): Itinerary {
        val base = Itinerary.create(tripId, SolveMode.DETERMINISTIC, GenerationMode.FULLY_AI, false,
            listOf(ItineraryDay.of(day, 0, listOf(VisitSlot.of(poiA, null, 0, LocalTime.parse("09:00"), LocalTime.parse("10:00"))))),
            clock.instant(),
        )
        return status(base)
    }

    val editReq = EditItinerary(
        listOf(
            EditDay(
                day,
                listOf(
                    EditSlot(poiB, LocalTime.parse("10:00"), LocalTime.parse("11:00"), isFixed = false, endsNextDay = false),
                    EditSlot(poiA, LocalTime.parse("12:00"), LocalTime.parse("13:00"), isFixed = false, endsNextDay = false),
                ),
            ),
        ),
    )

    fun repoWith(it: Itinerary) = EditFakeItineraries().apply { replaceForTrip(tripId, it) }

    "이력 기록이 실패하면 편집도 롤백된다(같은 트랜잭션 — 이 PR 의 핵심 보장)" {
        val tx = RecordingTx()
        shouldThrow<RuntimeException> {
            EditItineraryService(trips(true), repoWith(current()), EditFakeAgent(), revisionSvc(FakeRevisions().apply { failOnAppend = true }, repoWith(current()), tx, clock), CapturingChangeLogs(), FreezeAllSnapshots(), tx, FakeRejectionStore(), clock)
                .edit(acc, tripId, editReq)
        }
        // 기록이 tx 밖으로 나가면 이 단언이 깨진다 — 일정만 바뀌고 이력이 빠지는 상태를 막는 회귀 가드.
        tx.rolledBack shouldBe true
    }

    "내용이 그대로면 이력을 남기지 않는다(append-only 라 지울 수 없다)" {
        val base = current()
        val log = FakeRevisions()
        // 현재 상태와 동일한 편집안 — 전후가 같다
        val sameAsCurrent = EditItinerary(
            base.days.map { d -> EditDay(d.date, d.slots.map { EditSlot(it.sourcePoiId, it.startAt, it.endAt, it.isFixed, it.endsNextDay) }) },
        )
        val repo = repoWith(base)
        EditItineraryService(trips(true), repo, EditFakeAgent(), revisionSvc(log, repo, NOOP_TX, clock), CapturingChangeLogs(), FreezeAllSnapshots(), NOOP_TX, FakeRejectionStore(), clock)
            .edit(acc, tripId, sameAsCurrent)
        // BASELINE(되돌리기 지점)은 남지만 EDIT 리비전은 쌓이지 않는다 — 같은 버전으로 목록이 도배된다.
        log.appended.none { it.kind == RevisionKind.EDIT } shouldBe true
    }

    "편집하면 되돌리기 지점(편집 전)과 결과(EDIT)가 함께 남는다" {
        val repo = repoWith(current())
        val log = FakeRevisions()
        EditItineraryService(trips(true), repo, EditFakeAgent(), revisionSvc(log, repo, NOOP_TX, clock), CapturingChangeLogs(), FreezeAllSnapshots(), NOOP_TX, FakeRejectionStore(), clock)
            .edit(acc, tripId, editReq.copy(reason = "비 예보로 실내로 변경"))

        // 첫 편집이면 편집 전 상태가 BASELINE 으로 먼저 남아야 한다 — 없으면 원본으로 못 돌아간다(INV-U3-08)
        val baseline = log.appended.first()
        baseline.kind shouldBe RevisionKind.BASELINE
        baseline.snapshot.days.single().slots.map { it.poiId } shouldBe current().days.single().slots.map { it.sourcePoiId }

        // 편집 결과가 EDIT 로 쌓인다 — 사용자가 실제로 본 버전이 목록에 있어야 되돌릴 수 있다
        val edited = log.appended.last()
        edited.kind shouldBe RevisionKind.EDIT
        edited.actor shouldBe RevisionActor.USER
        edited.summary shouldBe "비 예보로 실내로 변경"
        edited.snapshot.days.single().slots.map { it.poiId } shouldBe editReq.days.single().slots.map { it.poiId }
    }

    "사유가 없으면 기본 문구로 남는다(summary 는 표시 문구라 비울 수 없다)" {
        val repo = repoWith(current())
        val log = FakeRevisions()
        EditItineraryService(trips(true), repo, EditFakeAgent(), revisionSvc(log, repo, NOOP_TX, clock), CapturingChangeLogs(), FreezeAllSnapshots(), NOOP_TX, FakeRejectionStore(), clock)
            .edit(acc, tripId, editReq)
        log.appended.last().summary shouldBe "일정을 직접 수정함"
    }

    "편집이 거부되면 이력도 남지 않는다(여행 전 확정 일정)" {
        val preTrip = Clock.fixed(Instant.parse("2026-07-20T00:00:00Z"), ZoneOffset.UTC) // 여행(08-01) 전이라 확정 잠금이 산다
        val base = current()
        val snapshots = base.days.flatMap { it.slots }.associate { it.sourcePoiId to UUID.randomUUID() }
        val repo = repoWith(base.confirm(snapshots, clock.instant()))
        val log = FakeRevisions()
        shouldThrow<ConflictDetected> {
            EditItineraryService(trips(true), repo, EditFakeAgent(), revisionSvc(log, repo, NOOP_TX, preTrip), CapturingChangeLogs(), FreezeAllSnapshots(), NOOP_TX, FakeRejectionStore(), preTrip).edit(acc, tripId, editReq)
        }
        log.appended shouldBe emptyList()
    }

    "편집해도 추천 근거·후보 요약이 살아남는다(TRIP-306 회귀 가드)" {
        // 편집안의 장소 중 하나에 근거를 달아두고, 편집 후에도 그 장소에 붙어 있는지 본다
        val poi = editReq.days.single().slots.first().poiId
        val base = Itinerary.reconstitute(
            UUID.randomUUID(), tripId, ItineraryStatus.PLANNED, SolveMode.FULL_AI, GenerationMode.FULLY_AI, false,
            GenerationState.COMPLETE,
            listOf(
                ItineraryDay.of(
                    day, 0,
                    listOf(VisitSlot.of(poi, null, 0, LocalTime.parse("09:00"), LocalTime.parse("10:00"), placementReason = "취향에 맞는 곳")),
                ),
            ),
            clock.instant(), clock.instant(), CandidatesSummary("LOW", 7, listOf("CAFE")), emptyList(),
        )
        val result = repoWith(base).let { r -> EditItineraryService(trips(true), r, EditFakeAgent(), revisionSvc(FakeRevisions(), r, NOOP_TX, clock), CapturingChangeLogs(), FreezeAllSnapshots(), NOOP_TX, FakeRejectionStore(), clock) }
            .edit(acc, tripId, editReq)

        // 장소를 옮겼다고 "왜 이 장소를 골랐는지"가 사라지면 안 된다
        result.days.single().slots.first { it.sourcePoiId == poi }.placementReason shouldBe "취향에 맞는 곳"
        result.candidatesSummary?.level shouldBe "LOW"
    }

    "편집하면 새 배열로 교체 + 위반 없으면 hasViolation=false" {
        val repo = repoWith(current())
        val svc = EditItineraryService(trips(true), repo, EditFakeAgent(), revisionSvc(FakeRevisions(), repo, NOOP_TX, clock), CapturingChangeLogs(), FreezeAllSnapshots(), NOOP_TX, FakeRejectionStore(), clock)
        val result = svc.edit(acc, tripId, editReq)
        val slots = result.days.single().slots
        slots.map { it.sourcePoiId } shouldBe listOf(poiB, poiA) // 편집 순서
        slots.all { !it.hasViolation } shouldBe true
    }

    "validate 위반을 해당 슬롯 hasViolation 으로 표시(비차단 저장)" {
        val repo = repoWith(current())
        val svc = EditItineraryService(trips(true), repo, EditFakeAgent(listOf(Violation("TRAVEL_TIME", 0, 1, null))), revisionSvc(FakeRevisions(), repo, NOOP_TX, clock), CapturingChangeLogs(), FreezeAllSnapshots(), NOOP_TX, FakeRejectionStore(), clock)
        val slots = svc.edit(acc, tripId, editReq).days.single().slots
        slots[0].hasViolation shouldBe false
        slots[1].hasViolation shouldBe true // day0/slot1 위반
    }

    "자정 넘김 슬롯을 편집해도 플래그가 보존된다(회귀)" {
        val repo = repoWith(current())
        val midnightEdit = EditItinerary(
            listOf(EditDay(day, listOf(EditSlot(poiA, LocalTime.parse("23:00"), LocalTime.parse("01:00"), isFixed = false, endsNextDay = true)))),
        )
        val slot = EditItineraryService(trips(true), repo, EditFakeAgent(), revisionSvc(FakeRevisions(), repo, NOOP_TX, clock), CapturingChangeLogs(), FreezeAllSnapshots(), NOOP_TX, FakeRejectionStore(), clock)
            .edit(acc, tripId, midnightEdit).days.single().slots.single()
        slot.endsNextDay shouldBe true
        slot.endAt shouldBe LocalTime.parse("01:00")
    }

    "여행 시작 전에는 확정 일정 편집 불가 409 — 잠금은 여행 전에만 남는다(TRIP-999)" {
        val preTrip = Clock.fixed(Instant.parse("2026-07-20T00:00:00Z"), ZoneOffset.UTC) // 여행(08-01) 전
        val repo = repoWith(current { it.confirm(clock.instant()) })
        shouldThrow<ConflictDetected> { EditItineraryService(trips(true), repo, EditFakeAgent(), revisionSvc(FakeRevisions(), repo, NOOP_TX, preTrip), CapturingChangeLogs(), FreezeAllSnapshots(), NOOP_TX, FakeRejectionStore(), preTrip).edit(acc, tripId, editReq) }
    }

    "여행 중에는 확정 일정도 편집된다 — 상태 유지·동결 승계·새 장소 동결·MANUAL 이력 1행(TRIP-999)" {
        // 시계(08-06)가 여행 시작(08-01) 뒤다 — 이 파일의 기본 시계가 곧 여행 중이다.
        val snapA = UUID.randomUUID()
        val repo = repoWith(current { it.confirm(mapOf(poiA to snapA), clock.instant()) })
        val logs = CapturingChangeLogs()
        val freezer = FreezeAllSnapshots()
        val saved = EditItineraryService(trips(true), repo, EditFakeAgent(), revisionSvc(FakeRevisions(), repo, NOOP_TX, clock), logs, freezer, NOOP_TX, FakeRejectionStore(), clock)
            .edit(acc, tripId, editReq)

        saved.status shouldBe ItineraryStatus.CONFIRMED // 편집이 확정을 조용히 풀지 않는다(FE 허브 판정이 여기 걸려 있다)
        val byPoi = saved.days.single().slots.associateBy { it.sourcePoiId }
        byPoi.getValue(poiA).poiSnapshotId shouldBe snapA // 동결 승계(INV-U1-03) — 전체 교체 편집이 참조를 지우면 안 된다
        byPoi.getValue(poiB).poiSnapshotId shouldNotBe null // 새 장소는 저장 시점에 동결
        freezer.frozen shouldBe listOf(poiB) // 이미 얼린 것은 다시 얼리지 않는다
        logs.appended.single().sourceType shouldBe ChangeSourceType.MANUAL // BR-U4-30
        logs.appended.single().reason.isNullOrBlank() shouldBe false // BR-U4-31 — 비워 두지 않는다
    }

    "새 장소 동결이 실패해도 저장은 막지 않는다 — 참조만 비운다(비차단, US-SCHED-07)" {
        val snapA = UUID.randomUUID()
        val repo = repoWith(current { it.confirm(mapOf(poiA to snapA), clock.instant()) })
        val freezer = FreezeAllSnapshots().apply { freezeFails = true }
        val saved = EditItineraryService(trips(true), repo, EditFakeAgent(), revisionSvc(FakeRevisions(), repo, NOOP_TX, clock), CapturingChangeLogs(), freezer, NOOP_TX, FakeRejectionStore(), clock)
            .edit(acc, tripId, editReq)

        val byPoi = saved.days.single().slots.associateBy { it.sourcePoiId }
        byPoi.getValue(poiA).poiSnapshotId shouldBe snapA // 있던 동결은 실패와 무관하게 남는다
        byPoi.getValue(poiB).poiSnapshotId shouldBe null // 표면은 정본(live) 폴백으로 그려진다
    }

    "생성 중에도 이미 만들어진 일자만 고치는 편집은 저장된다(TRIP-1000)" {
        // day1 조기 노출(BR-U3-04·06) — 2차가 도는 동안에도 도착한 1일차는 손댈 수 있어야 한다.
        val partial = Itinerary.create(
            tripId, SolveMode.DETERMINISTIC, GenerationMode.FULLY_AI, false,
            listOf(ItineraryDay.of(day, 0, listOf(VisitSlot.of(poiA, null, 0, LocalTime.parse("09:00"), LocalTime.parse("10:00"))))),
            clock.instant(), GenerationState.PARTIAL,
        )
        val repo = repoWith(partial)
        val saved = EditItineraryService(trips(true), repo, EditFakeAgent(), revisionSvc(FakeRevisions(), repo, NOOP_TX, clock), CapturingChangeLogs(), FreezeAllSnapshots(), NOOP_TX, FakeRejectionStore(), clock)
            .edit(acc, tripId, editReq) // editReq 는 day(이미 존재) 만 싣는다

        saved.generationState shouldBe GenerationState.PARTIAL // 편집이 생성 진행 상태를 바꾸지 않는다
        saved.days.single().slots.map { it.sourcePoiId } shouldBe listOf(poiB, poiA)
    }

    "생성 중에 아직 없는 일자를 실으면 409 — 2차와 누가 이길지 정의가 없다" {
        val partial = Itinerary.create(
            tripId, SolveMode.DETERMINISTIC, GenerationMode.FULLY_AI, false,
            listOf(ItineraryDay.of(day, 0, listOf(VisitSlot.of(poiA, null, 0, LocalTime.parse("09:00"), LocalTime.parse("10:00"))))),
            clock.instant(), GenerationState.PARTIAL,
        )
        val repo = repoWith(partial)
        val withNewDay = EditItinerary(
            listOf(
                EditDay(day, listOf(EditSlot(poiA, LocalTime.parse("09:00"), LocalTime.parse("10:00"), isFixed = false, endsNextDay = false))),
                EditDay(day.plusDays(1), listOf(EditSlot(poiB, LocalTime.parse("10:00"), LocalTime.parse("11:00"), isFixed = false, endsNextDay = false))),
            ),
        )
        shouldThrow<ConflictDetected> {
            EditItineraryService(trips(true), repo, EditFakeAgent(), revisionSvc(FakeRevisions(), repo, NOOP_TX, clock), CapturingChangeLogs(), FreezeAllSnapshots(), NOOP_TX, FakeRejectionStore(), clock)
                .edit(acc, tripId, withNewDay)
        }
    }

    // ───── 거리 보존 (TRIP-1002 결정 (a)) ──────────────────────────────────

    fun distSlot(poi: UUID, order: Int, start: String, distance: String?) = VisitSlot.of(
        poi, null, order, LocalTime.parse(start), LocalTime.parse(start).plusHours(1), distanceRange = distance,
    )

    fun editOf(vararg pois: UUID) = EditItinerary(
        listOf(EditDay(day, pois.mapIndexed { i, p -> EditSlot(p, LocalTime.of(9 + i, 0), LocalTime.of(10 + i, 0), isFixed = false, endsNextDay = false) })),
    )

    "시각만 바꾼 편집은 거리를 전부 보존한다 — 커넥터 '계산 중' 영구 고착의 원인 제거(QA #055)" {
        val poiC = UUID.randomUUID()
        val withDistances = Itinerary.create(tripId, SolveMode.FULL_AI, GenerationMode.FULLY_AI, false,
            listOf(ItineraryDay.of(day, 0, listOf(
                distSlot(poiA, 0, "09:00", "약 0.2km · 대중교통 추정"),
                distSlot(poiB, 1, "11:00", "약 0.7km"),
                distSlot(poiC, 2, "13:00", "약 1.8km"),
            ))), clock.instant(),
        )
        val repo = repoWith(withDistances)
        val saved = EditItineraryService(trips(true), repo, EditFakeAgent(), revisionSvc(FakeRevisions(), repo, NOOP_TX, clock), CapturingChangeLogs(), FreezeAllSnapshots(), NOOP_TX, FakeRejectionStore(), clock)
            .edit(acc, tripId, editOf(poiA, poiB, poiC)) // 순서 그대로, 시각만 이동

        saved.days.single().slots.map { it.distanceRange } shouldBe
            listOf("약 0.2km · 대중교통 추정", "약 0.7km", "약 1.8km")
    }

    "슬롯 하나를 교체하면 인접 쌍이 바뀐 구간만 비운다 — 나머지 거리는 남는다" {
        val poiC = UUID.randomUUID()
        val poiD = UUID.randomUUID()
        val poiX = UUID.randomUUID() // 교체 투입
        val withDistances = Itinerary.create(tripId, SolveMode.FULL_AI, GenerationMode.FULLY_AI, false,
            listOf(ItineraryDay.of(day, 0, listOf(
                distSlot(poiA, 0, "09:00", "dA"),
                distSlot(poiB, 1, "11:00", "dB"),
                distSlot(poiC, 2, "13:00", "dC"),
                distSlot(poiD, 3, "15:00", "dD"),
            ))), clock.instant(),
        )
        val repo = repoWith(withDistances)
        val saved = EditItineraryService(trips(true), repo, EditFakeAgent(), revisionSvc(FakeRevisions(), repo, NOOP_TX, clock), CapturingChangeLogs(), FreezeAllSnapshots(), NOOP_TX, FakeRejectionStore(), clock)
            .edit(acc, tripId, editOf(poiA, poiX, poiC, poiD)) // B → X 교체

        val byPoi = saved.days.single().slots.associateBy { it.sourcePoiId }
        byPoi.getValue(poiA).distanceRange shouldBe "dA" // 첫 구간(앵커→A) 불변
        byPoi.getValue(poiX).distanceRange shouldBe null // A→X 는 새 구간 — 지어내지 않는다(INV-2)
        byPoi.getValue(poiC).distanceRange shouldBe null // 직전이 B→X 로 바뀜
        byPoi.getValue(poiD).distanceRange shouldBe "dD" // C→D 불변
    }

    "속성: 임의 순열 편집에서 거리 보존 = 인접 쌍 불변(TRIP-1002 AC)" {
        val pois = List(6) { UUID.randomUUID() }
        checkAll(Arb.shuffle(pois)) { order ->
            val withDistances = Itinerary.create(tripId, SolveMode.FULL_AI, GenerationMode.FULLY_AI, false,
                listOf(ItineraryDay.of(day, 0, pois.mapIndexed { i, p -> distSlot(p, i, "0${i + 1}:00", "d$i") })),
                clock.instant(),
            )
            val repo = repoWith(withDistances)
            val saved = EditItineraryService(trips(true), repo, EditFakeAgent(), revisionSvc(FakeRevisions(), repo, NOOP_TX, clock), CapturingChangeLogs(), FreezeAllSnapshots(), NOOP_TX, FakeRejectionStore(), clock)
                .edit(acc, tripId, editOf(*order.toTypedArray()))

            val originalLegs = pois.mapIndexed { i, p -> (if (i == 0) null else pois[i - 1]) to p }.toSet()
            saved.days.single().slots.forEachIndexed { i, slot ->
                val leg = (if (i == 0) null else order[i - 1]) to order[i]
                (slot.distanceRange != null) shouldBe (leg in originalLegs) // 보존 ⇔ 인접 쌍 불변
            }
        }
    }

    "무변경 편집이면 변경 이력도 쌓이지 않는다" {
        val repo = repoWith(current())
        val logs = CapturingChangeLogs()
        val same = EditItinerary(
            listOf(EditDay(day, listOf(EditSlot(poiA, LocalTime.parse("09:00"), LocalTime.parse("10:00"), isFixed = false, endsNextDay = false)))),
        )
        EditItineraryService(trips(true), repo, EditFakeAgent(), revisionSvc(FakeRevisions(), repo, NOOP_TX, clock), logs, FreezeAllSnapshots(), NOOP_TX, FakeRejectionStore(), clock)
            .edit(acc, tripId, same)

        logs.appended.isEmpty() shouldBe true
    }

    // ── 거절 이력 (TRIP-964) ────────────────────────────────────────────────

    /**
     * **빠진 POI = 거절.** 사용자가 그 자리를 보고 바꾼 것이라 가장 명확한 신호다(SWAPPED_OUT).
     * 편집 PUT 은 전체 교체라, 이전에 있었고 새 일정에 없는 것이 곧 밀려난 것이다.
     */
    "편집에서 빠진 POI 가 SWAPPED_OUT 으로 쌓인다" {
        val store = FakeRejectionStore()
        val repo = repoWith(current()) // 현행 = [poiA]
        val edited = EditItinerary(
            listOf(EditDay(day, listOf(EditSlot(poiB, LocalTime.parse("10:00"), LocalTime.parse("11:00"), isFixed = false, endsNextDay = false)))),
        ) // poiA → poiB 교체

        EditItineraryService(trips(true), repo, EditFakeAgent(), revisionSvc(FakeRevisions(), repo, NOOP_TX, clock), CapturingChangeLogs(), FreezeAllSnapshots(), NOOP_TX, store, clock)
            .edit(acc, tripId, edited)

        store.findByTrip(tripId) shouldBe listOf(RejectedPoi(poiA, RejectedPoi.Kind.SWAPPED_OUT, 1))
    }

    /** 시간만 옮긴 편집은 아무도 밀려나지 않았다 — 거절 0건이어야 한다. 아니면 시각 조정마다 애먼 강등이 쌓인다. */
    "시간만 바꾼 편집은 거절을 쌓지 않는다" {
        val store = FakeRejectionStore()
        val repo = repoWith(current())
        val timeOnly = EditItinerary(
            listOf(EditDay(day, listOf(EditSlot(poiA, LocalTime.parse("14:00"), LocalTime.parse("15:00"), isFixed = false, endsNextDay = false)))),
        )

        EditItineraryService(trips(true), repo, EditFakeAgent(), revisionSvc(FakeRevisions(), repo, NOOP_TX, clock), CapturingChangeLogs(), FreezeAllSnapshots(), NOOP_TX, store, clock)
            .edit(acc, tripId, timeOnly)

        store.byTrip shouldBe emptyMap()
    }

    "생성된 일정 없으면 404" {
        shouldThrow<ResourceNotFound> { EditFakeItineraries().let { r -> EditItineraryService(trips(true), r, EditFakeAgent(), revisionSvc(FakeRevisions(), r, NOOP_TX, clock), CapturingChangeLogs(), FreezeAllSnapshots(), NOOP_TX, FakeRejectionStore(), clock) }.edit(acc, tripId, editReq) }
    }

    "미소유 여행이면 404" {
        val repo = repoWith(current())
        shouldThrow<ResourceNotFound> { EditItineraryService(trips(false), repo, EditFakeAgent(), revisionSvc(FakeRevisions(), repo, NOOP_TX, clock), CapturingChangeLogs(), FreezeAllSnapshots(), NOOP_TX, FakeRejectionStore(), clock).edit(acc, tripId, editReq) }
    }

    "위반 사유는 사용자 정성 문구다 — 타입으로 번역하고 중복은 접는다(TRIP-1030)" {
        val repo = repoWith(current())
        val agent = EditFakeAgent(
            listOf(
                Violation("TRAVEL_TIME", 0, 0, "이동 54분 필요, 간격 -60분"), // 상대 detail — 그대로 내보내면 INV-3 위반
                Violation("OPENING_HOURS", 0, 0, "영업시간 밖: 543~618"),
                Violation("TRAVEL_TIME", 0, 0, "이동 54분 필요, 간격 -60분"), // 중복
            ),
        )
        val result = EditItineraryService(trips(true), repo, agent, revisionSvc(FakeRevisions(), repo, NOOP_TX, clock), CapturingChangeLogs(), FreezeAllSnapshots(), NOOP_TX, FakeRejectionStore(), clock)
            .edit(acc, tripId, editReq)

        val slot = result.days.single().slots.first()
        slot.hasViolation shouldBe true
        slot.violationReason shouldBe "앞 장소에서 이동할 시간이 빠듯해요 · 영업시간과 맞지 않아요"
        // 숫자 소요시간·원시 분값·영문 코드가 새지 않는다(QA #079 #064 재발 잠금)
        Regex("""\d+\s*분|\d+\s*시간|\d{3,}|[A-Z_]{2,}""").containsMatchIn(slot.violationReason!!) shouldBe false
    }

    "AI 재검증이 실패해도 편집은 500 이 되지 않는다 — 저장되고 직전 위반 표시가 유지된다" {
        // 현행 poiA 슬롯에 이미 위반이 표시돼 있고, 편집안도 같은 날 poiA 를 유지한다.
        val flagged = Itinerary.create(
            tripId, SolveMode.DETERMINISTIC, GenerationMode.FULLY_AI, false,
            listOf(
                ItineraryDay.of(
                    day, 0,
                    listOf(
                        VisitSlot.of(
                            poiA, null, 0, LocalTime.parse("09:00"), LocalTime.parse("10:00"),
                            hasViolation = true, violationReason = "영업시간 밖",
                        ),
                    ),
                ),
            ),
            clock.instant(),
        )
        val repo = repoWith(flagged)
        val down = EditFakeAgent(failure = RuntimeException("AI 다운"))

        val result = EditItineraryService(trips(true), repo, down, revisionSvc(FakeRevisions(), repo, NOOP_TX, clock), CapturingChangeLogs(), FreezeAllSnapshots(), NOOP_TX, FakeRejectionStore(), clock)
            .edit(acc, tripId, editReq)

        // 편집은 사용자의 의도라 저장된다
        result.days.single().slots.map { it.sourcePoiId } shouldBe listOf(poiB, poiA)
        // 판정을 못 했으니 "깨끗하다"고 말하지 않는다 — 플래그는 남는다. 다만 이 편집이 poiA 의
        // 시각을 옮겼으므로 옛 사유를 그대로 붙이면 바뀐 시각에 참이 아닐 수 있다 → 중립 문구(TRIP-1030 결정 3).
        val a = result.days.single().slots.single { it.sourcePoiId == poiA }
        a.hasViolation shouldBe true
        a.violationReason shouldBe PriorViolations.STALE_REASON
        // 이력 없는 새 슬롯은 표시가 없다(원래 기본값 — 새 거짓을 만들지 않는다)
        result.days.single().slots.single { it.sourcePoiId == poiB }.hasViolation shouldBe false
    }

    "편집해도 미배치 보고는 보존된다 — 슬롯을 옮겼다고 못 넣었던 곳이 들어간 건 아니다" {
        val missed = UUID.randomUUID()
        val base = Itinerary.reconstitute(
            UUID.randomUUID(), tripId, ItineraryStatus.PLANNED, SolveMode.DETERMINISTIC, GenerationMode.FULLY_AI, false,
            GenerationState.COMPLETE,
            listOf(ItineraryDay.of(day, 0, listOf(VisitSlot.of(poiA, null, 0, LocalTime.parse("09:00"), LocalTime.parse("10:00"))))),
            clock.instant(), clock.instant(), null,
            listOf(UnplacedMustVisit(missed, UnplacedReason.WINDOW_CONFLICT)),
        )
        val repo = repoWith(base)
        val result = EditItineraryService(trips(true), repo, EditFakeAgent(), revisionSvc(FakeRevisions(), repo, NOOP_TX, clock), CapturingChangeLogs(), FreezeAllSnapshots(), NOOP_TX, FakeRejectionStore(), clock)
            .edit(acc, tripId, editReq)

        result.unplacedMustVisits.single().poiId shouldBe missed
    }

    "detail 이 없어도 타입만으로 사용자 문구를 만든다 — 배지만 켜고 이유를 숨기지 않는다(TRIP-1030)" {
        val repo = repoWith(current())
        val agent = EditFakeAgent(listOf(Violation("HC1", 0, 0, null)))
        val slot = EditItineraryService(trips(true), repo, agent, revisionSvc(FakeRevisions(), repo, NOOP_TX, clock), CapturingChangeLogs(), FreezeAllSnapshots(), NOOP_TX, FakeRejectionStore(), clock)
            .edit(acc, tripId, editReq).days.single().slots.first()

        slot.hasViolation shouldBe true
        slot.violationReason shouldBe "영업시간과 맞지 않아요"
    }

    "모르는 위반 타입도 한국어 일반 문구다 — 영문 코드가 화면에 새지 않는다" {
        val repo = repoWith(current())
        val agent = EditFakeAgent(listOf(Violation("HC9_FUTURE", 0, 0, "whatever")))
        val slot = EditItineraryService(trips(true), repo, agent, revisionSvc(FakeRevisions(), repo, NOOP_TX, clock), CapturingChangeLogs(), FreezeAllSnapshots(), NOOP_TX, FakeRejectionStore(), clock)
            .edit(acc, tripId, editReq).days.single().slots.first()

        slot.violationReason shouldBe "일정 조건과 맞지 않아요"
    }

    "위치를 못 찾은 위반은 어느 슬롯에도 안 붙는다 — 조용히 사라지지 않게 로그로 드러낸다" {
        val repo = repoWith(current())
        val agent = EditFakeAgent(listOf(Violation("HC3_UNPLACED", null, null, "필수 방문지가 배치되지 않았습니다")))
        val result = EditItineraryService(trips(true), repo, agent, revisionSvc(FakeRevisions(), repo, NOOP_TX, clock), CapturingChangeLogs(), FreezeAllSnapshots(), NOOP_TX, FakeRejectionStore(), clock)
            .edit(acc, tripId, editReq)

        // 슬롯 표시로는 나타나지 않는다(붙일 자리가 없다) — 사용자 표면 노출은 별도 계약이 필요하다.
        result.days.single().slots.all { !it.hasViolation } shouldBe true
    }

    // ───── 장소 교체 편집 → repair 로 시각·거리 재산출 (2026-10-05 제보) ─────────────────────

    /** 수리 결과를 흉내낸다 — 각 슬롯을 [shiftMin] 분 뒤로 밀고 거리 문자열을 채운다(상대 조립 대역). */
    fun shiftingRepair(shiftMin: Long = 30): (ScheduleAgentOutput) -> RepairResult = { sol ->
        RepairResult(
            sol.copy(days = sol.days.map { d ->
                d.copy(slots = d.slots.mapIndexed { i, s ->
                    if (s.isFixed) s.copy(distanceRange = if (i == 0) null else "r$i")
                    else s.copy(startAt = s.startAt.plusMinutes(shiftMin), endAt = s.endAt.plusMinutes(shiftMin),
                        distanceRange = if (i == 0) null else "r$i")
                })
            }),
            listOf("shifted"),
        )
    }

    fun fourStops(poiC: UUID, poiD: UUID) = Itinerary.create(tripId, SolveMode.FULL_AI, GenerationMode.FULLY_AI, false,
        listOf(ItineraryDay.of(day, 0, listOf(
            distSlot(poiA, 0, "09:00", "dA"), distSlot(poiB, 1, "11:00", "dB"),
            distSlot(poiC, 2, "13:00", "dC"), distSlot(poiD, 3, "15:00", "dD"),
        ))), clock.instant(),
    )

    "장소를 교체하면 repair 의 시각·거리로 저장한다 — 안 바뀐 구간 거리는 그대로, 위반 표시 없음" {
        val poiC = UUID.randomUUID(); val poiD = UUID.randomUUID(); val poiX = UUID.randomUUID()
        val repo = repoWith(fourStops(poiC, poiD))
        val agent = EditFakeAgent(listOf(Violation("TRAVEL_TIME", 0, 1, null)), repairWith = shiftingRepair())
        val saved = EditItineraryService(trips(true), repo, agent, revisionSvc(FakeRevisions(), repo, NOOP_TX, clock), CapturingChangeLogs(), FreezeAllSnapshots(), NOOP_TX, FakeRejectionStore(), clock)
            .edit(acc, tripId, editOf(poiA, poiX, poiC, poiD))

        agent.repairCalls shouldBe 1
        agent.validateCalls shouldBe 0 // 수리값은 상대가 재검증을 마친 값이다(INV-2)
        val slots = saved.days.single().slots
        slots.map { it.sourcePoiId } shouldBe listOf(poiA, poiX, poiC, poiD)
        slots.map { it.startAt } shouldBe listOf(9, 10, 11, 12).map { LocalTime.of(it, 30) }
        slots.map { it.distanceRange } shouldBe listOf("dA", "r1", "r2", "dD")
        slots.all { !it.hasViolation } shouldBe true
    }

    "시각만 바꾼 편집은 repair 를 부르지 않는다 — 사용자 시각 그대로" {
        val poiC = UUID.randomUUID(); val poiD = UUID.randomUUID()
        val repo = repoWith(fourStops(poiC, poiD))
        val agent = EditFakeAgent(repairWith = shiftingRepair())
        val saved = EditItineraryService(trips(true), repo, agent, revisionSvc(FakeRevisions(), repo, NOOP_TX, clock), CapturingChangeLogs(), FreezeAllSnapshots(), NOOP_TX, FakeRejectionStore(), clock)
            .edit(acc, tripId, editOf(poiA, poiB, poiC, poiD))

        agent.repairCalls shouldBe 0
        agent.validateCalls shouldBe 1
        saved.days.single().slots.map { it.startAt } shouldBe listOf(9, 10, 11, 12).map { LocalTime.of(it, 0) }
        saved.days.single().slots.map { it.distanceRange } shouldBe listOf("dA", "dB", "dC", "dD")
    }

    "repair 가 장소 순서를 바꾸면 쓰지 않는다 — 종전 validate 표시로 떨어진다" {
        val poiC = UUID.randomUUID(); val poiD = UUID.randomUUID(); val poiX = UUID.randomUUID()
        val repo = repoWith(fourStops(poiC, poiD))
        val reordering: (ScheduleAgentOutput) -> RepairResult = { sol ->
            RepairResult(sol.copy(days = sol.days.map { d -> d.copy(slots = d.slots.reversed()) }), emptyList())
        }
        val agent = EditFakeAgent(listOf(Violation("TRAVEL_TIME", 0, 1, null)), repairWith = reordering)
        val saved = EditItineraryService(trips(true), repo, agent, revisionSvc(FakeRevisions(), repo, NOOP_TX, clock), CapturingChangeLogs(), FreezeAllSnapshots(), NOOP_TX, FakeRejectionStore(), clock)
            .edit(acc, tripId, editOf(poiA, poiX, poiC, poiD))

        agent.validateCalls shouldBe 1
        val slots = saved.days.single().slots
        slots.map { it.sourcePoiId } shouldBe listOf(poiA, poiX, poiC, poiD) // 사용자 선택 존중
        slots.map { it.startAt } shouldBe listOf(9, 10, 11, 12).map { LocalTime.of(it, 0) }
        slots[1].hasViolation shouldBe true
        slots.map { it.distanceRange } shouldBe listOf("dA", null, null, "dD")
    }

    "repair 가 고정 슬롯 시각을 옮기면 쓰지 않는다 — 고정은 보정도 못 건드린다(BR-U3-14)" {
        val poiX = UUID.randomUUID()
        val repo = repoWith(current())
        val movesAll: (ScheduleAgentOutput) -> RepairResult = { sol ->
            RepairResult(sol.copy(days = sol.days.map { d -> d.copy(slots = d.slots.map { it.copy(startAt = it.startAt.plusHours(1), endAt = it.endAt.plusHours(1)) }) }), emptyList())
        }
        val agent = EditFakeAgent(repairWith = movesAll)
        val pinned = EditItinerary(listOf(EditDay(day, listOf(
            EditSlot(poiA, LocalTime.of(9, 0), LocalTime.of(10, 0), isFixed = true, endsNextDay = false),
            EditSlot(poiX, LocalTime.of(10, 0), LocalTime.of(11, 0), isFixed = false, endsNextDay = false),
        ))))
        val saved = EditItineraryService(trips(true), repo, agent, revisionSvc(FakeRevisions(), repo, NOOP_TX, clock), CapturingChangeLogs(), FreezeAllSnapshots(), NOOP_TX, FakeRejectionStore(), clock)
            .edit(acc, tripId, pinned)

        agent.validateCalls shouldBe 1
        saved.days.single().slots.first().startAt shouldBe LocalTime.of(9, 0)
        saved.days.single().slots.first().isFixed shouldBe true
    }

    "repair 가 수리 불가면 종전 동작 — validate 위반 표시·바뀐 구간 거리 null" {
        val poiC = UUID.randomUUID(); val poiD = UUID.randomUUID(); val poiX = UUID.randomUUID()
        val repo = repoWith(fourStops(poiC, poiD))
        val agent = EditFakeAgent(listOf(Violation("TRAVEL_TIME", 0, 1, null)))
        val saved = EditItineraryService(trips(true), repo, agent, revisionSvc(FakeRevisions(), repo, NOOP_TX, clock), CapturingChangeLogs(), FreezeAllSnapshots(), NOOP_TX, FakeRejectionStore(), clock)
            .edit(acc, tripId, editOf(poiA, poiX, poiC, poiD))

        agent.repairCalls shouldBe 1
        agent.validateCalls shouldBe 1
        saved.days.single().slots[1].hasViolation shouldBe true
        saved.days.single().slots.map { it.distanceRange } shouldBe listOf("dA", null, null, "dD")
    }

    "repair 호출이 실패하면 편집은 저장되고 판정 보류 — AI 를 두 번 기다리지 않는다" {
        val poiC = UUID.randomUUID(); val poiD = UUID.randomUUID(); val poiX = UUID.randomUUID()
        val repo = repoWith(fourStops(poiC, poiD))
        val agent = EditFakeAgent(failure = RuntimeException("AI 다운"))
        val saved = EditItineraryService(trips(true), repo, agent, revisionSvc(FakeRevisions(), repo, NOOP_TX, clock), CapturingChangeLogs(), FreezeAllSnapshots(), NOOP_TX, FakeRejectionStore(), clock)
            .edit(acc, tripId, editOf(poiA, poiX, poiC, poiD))

        agent.validateCalls shouldBe 0
        saved.days.single().slots.map { it.sourcePoiId } shouldBe listOf(poiA, poiX, poiC, poiD)
        saved.days.single().slots.map { it.startAt } shouldBe listOf(9, 10, 11, 12).map { LocalTime.of(it, 0) }
    }

    "속성: repair 호출 ⇔ 인접 쌍 집합이 바뀜, 저장 순서는 언제나 사용자 편집 순서" {
        val pois = List(5) { UUID.randomUUID() }
        checkAll(Arb.shuffle(pois)) { order ->
            val base = Itinerary.create(tripId, SolveMode.FULL_AI, GenerationMode.FULLY_AI, false,
                listOf(ItineraryDay.of(day, 0, pois.mapIndexed { i, p -> distSlot(p, i, "0${i + 1}:00", "d$i") })),
                clock.instant(),
            )
            val repo = repoWith(base)
            val agent = EditFakeAgent(repairWith = shiftingRepair())
            val saved = EditItineraryService(trips(true), repo, agent, revisionSvc(FakeRevisions(), repo, NOOP_TX, clock), CapturingChangeLogs(), FreezeAllSnapshots(), NOOP_TX, FakeRejectionStore(), clock)
                .edit(acc, tripId, editOf(*order.toTypedArray()))

            val legsChanged = order != pois
            agent.repairCalls shouldBe (if (legsChanged) 1 else 0)
            saved.days.single().slots.map { it.sourcePoiId } shouldBe order
            saved.days.single().slots.all { it.distanceRange != null || it.orderIndex == 0 } shouldBe true
        }
    }
})
