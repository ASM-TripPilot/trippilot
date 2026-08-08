package com.trippilot.itinerarygeneration.application

import com.trippilot.core.error.ConflictDetected
import com.trippilot.core.error.ResourceNotFound
import com.trippilot.itinerarygeneration.domain.Itinerary
import com.trippilot.itinerarygeneration.domain.RevisionKind
import com.trippilot.itinerarygeneration.domain.RevisionActor
import com.trippilot.itinerarygeneration.domain.NewRevision
import com.trippilot.itinerarygeneration.domain.ItineraryRevisionRepository
import com.trippilot.itinerarygeneration.domain.ItineraryRevision
import com.trippilot.itinerarygeneration.domain.ItineraryRevisionSummary
import com.trippilot.itinerarygeneration.domain.ItineraryStatus
import com.trippilot.itinerarygeneration.domain.GenerationState
import com.trippilot.itinerarygeneration.domain.CandidatesSummary
import com.trippilot.itinerarygeneration.domain.ItineraryDay
import com.trippilot.itinerarygeneration.domain.ItineraryRepository
import com.trippilot.itinerarygeneration.domain.RepairResult
import com.trippilot.itinerarygeneration.domain.ScheduleAgentInput
import com.trippilot.itinerarygeneration.domain.ScheduleAgentOutput
import com.trippilot.itinerarygeneration.domain.ScheduleAgentPort
import com.trippilot.itinerarygeneration.domain.SolveMode
import com.trippilot.itinerarygeneration.domain.VisitSlot
import com.trippilot.itinerarygeneration.domain.Violation
import com.trippilot.trip.api.TripFacade
import com.trippilot.trip.api.TripGenerationContext
import com.trippilot.trip.api.TripPeriod
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

/** validate 는 주입된 위반을 반환(Fake). generate/repair 는 편집에서 미사용. */
private class EditFakeAgent(private val violations: List<Violation> = emptyList()) : ScheduleAgentPort {
    override fun generate(input: ScheduleAgentInput): ScheduleAgentOutput = throw NotImplementedError()
    override fun validate(solution: ScheduleAgentOutput): List<Violation> = violations
    override fun repair(solution: ScheduleAgentOutput, violations: List<Violation>) = RepairResult(solution, emptyList())
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
        val base = Itinerary.create(
            tripId, SolveMode.DETERMINISTIC, false,
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
            EditItineraryService(trips(true), repoWith(current()), EditFakeAgent(), revisionSvc(FakeRevisions().apply { failOnAppend = true }, repoWith(current()), tx, clock), tx, clock)
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
        EditItineraryService(trips(true), repo, EditFakeAgent(), revisionSvc(log, repo, NOOP_TX, clock), NOOP_TX, clock)
            .edit(acc, tripId, sameAsCurrent)
        // BASELINE(되돌리기 지점)은 남지만 EDIT 리비전은 쌓이지 않는다 — 같은 버전으로 목록이 도배된다.
        log.appended.none { it.kind == RevisionKind.EDIT } shouldBe true
    }

    "편집하면 되돌리기 지점(편집 전)과 결과(EDIT)가 함께 남는다" {
        val repo = repoWith(current())
        val log = FakeRevisions()
        EditItineraryService(trips(true), repo, EditFakeAgent(), revisionSvc(log, repo, NOOP_TX, clock), NOOP_TX, clock)
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
        EditItineraryService(trips(true), repo, EditFakeAgent(), revisionSvc(log, repo, NOOP_TX, clock), NOOP_TX, clock)
            .edit(acc, tripId, editReq)
        log.appended.last().summary shouldBe "일정을 직접 수정함"
    }

    "편집이 거부되면 이력도 남지 않는다(확정 일정)" {
        val base = current()
        val snapshots = base.days.flatMap { it.slots }.associate { it.sourcePoiId to UUID.randomUUID() }
        val repo = repoWith(base.confirm(snapshots, clock.instant()))
        val log = FakeRevisions()
        shouldThrow<ConflictDetected> {
            EditItineraryService(trips(true), repo, EditFakeAgent(), revisionSvc(log, repo, NOOP_TX, clock), NOOP_TX, clock).edit(acc, tripId, editReq)
        }
        log.appended shouldBe emptyList()
    }

    "편집해도 추천 근거·후보 요약이 살아남는다(TRIP-306 회귀 가드)" {
        // 편집안의 장소 중 하나에 근거를 달아두고, 편집 후에도 그 장소에 붙어 있는지 본다
        val poi = editReq.days.single().slots.first().poiId
        val base = Itinerary.reconstitute(
            UUID.randomUUID(), tripId, ItineraryStatus.PLANNED, SolveMode.FULL_AI, false,
            GenerationState.COMPLETE,
            listOf(
                ItineraryDay.of(
                    day, 0,
                    listOf(VisitSlot.of(poi, null, 0, LocalTime.parse("09:00"), LocalTime.parse("10:00"), placementReason = "취향에 맞는 곳")),
                ),
            ),
            clock.instant(), clock.instant(), CandidatesSummary("LOW", 7, listOf("CAFE")),
        )
        val result = repoWith(base).let { r -> EditItineraryService(trips(true), r, EditFakeAgent(), revisionSvc(FakeRevisions(), r, NOOP_TX, clock), NOOP_TX, clock) }
            .edit(acc, tripId, editReq)

        // 장소를 옮겼다고 "왜 이 장소를 골랐는지"가 사라지면 안 된다
        result.days.single().slots.first { it.sourcePoiId == poi }.placementReason shouldBe "취향에 맞는 곳"
        result.candidatesSummary?.level shouldBe "LOW"
    }

    "편집하면 새 배열로 교체 + 위반 없으면 hasViolation=false" {
        val repo = repoWith(current())
        val svc = EditItineraryService(trips(true), repo, EditFakeAgent(), revisionSvc(FakeRevisions(), repo, NOOP_TX, clock), NOOP_TX, clock)
        val result = svc.edit(acc, tripId, editReq)
        val slots = result.days.single().slots
        slots.map { it.sourcePoiId } shouldBe listOf(poiB, poiA) // 편집 순서
        slots.all { !it.hasViolation } shouldBe true
    }

    "validate 위반을 해당 슬롯 hasViolation 으로 표시(비차단 저장)" {
        val repo = repoWith(current())
        val svc = EditItineraryService(trips(true), repo, EditFakeAgent(listOf(Violation("TRAVEL_TIME", 0, 1, null))), revisionSvc(FakeRevisions(), repo, NOOP_TX, clock), NOOP_TX, clock)
        val slots = svc.edit(acc, tripId, editReq).days.single().slots
        slots[0].hasViolation shouldBe false
        slots[1].hasViolation shouldBe true // day0/slot1 위반
    }

    "자정 넘김 슬롯을 편집해도 플래그가 보존된다(회귀)" {
        val repo = repoWith(current())
        val midnightEdit = EditItinerary(
            listOf(EditDay(day, listOf(EditSlot(poiA, LocalTime.parse("23:00"), LocalTime.parse("01:00"), isFixed = false, endsNextDay = true)))),
        )
        val slot = EditItineraryService(trips(true), repo, EditFakeAgent(), revisionSvc(FakeRevisions(), repo, NOOP_TX, clock), NOOP_TX, clock)
            .edit(acc, tripId, midnightEdit).days.single().slots.single()
        slot.endsNextDay shouldBe true
        slot.endAt shouldBe LocalTime.parse("01:00")
    }

    "확정된 일정은 편집 불가 409" {
        val repo = repoWith(current { it.confirm(clock.instant()) })
        shouldThrow<ConflictDetected> { EditItineraryService(trips(true), repo, EditFakeAgent(), revisionSvc(FakeRevisions(), repo, NOOP_TX, clock), NOOP_TX, clock).edit(acc, tripId, editReq) }
    }

    "생성된 일정 없으면 404" {
        shouldThrow<ResourceNotFound> { EditFakeItineraries().let { r -> EditItineraryService(trips(true), r, EditFakeAgent(), revisionSvc(FakeRevisions(), r, NOOP_TX, clock), NOOP_TX, clock) }.edit(acc, tripId, editReq) }
    }

    "미소유 여행이면 404" {
        val repo = repoWith(current())
        shouldThrow<ResourceNotFound> { EditItineraryService(trips(false), repo, EditFakeAgent(), revisionSvc(FakeRevisions(), repo, NOOP_TX, clock), NOOP_TX, clock).edit(acc, tripId, editReq) }
    }
})
