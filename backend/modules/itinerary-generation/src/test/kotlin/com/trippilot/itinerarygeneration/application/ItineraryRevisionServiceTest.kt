package com.trippilot.itinerarygeneration.application

import com.trippilot.core.error.ConflictDetected
import com.trippilot.core.error.ResourceNotFound
import com.trippilot.itinerarygeneration.domain.GenerationMode
import com.trippilot.itinerarygeneration.domain.GenerationState
import com.trippilot.itinerarygeneration.domain.Itinerary
import com.trippilot.itinerarygeneration.domain.ItineraryDay
import com.trippilot.itinerarygeneration.domain.ItineraryRepository
import com.trippilot.itinerarygeneration.domain.ItineraryRevision
import com.trippilot.itinerarygeneration.domain.ItineraryRevisionSummary
import com.trippilot.itinerarygeneration.domain.ItineraryRevisionRepository
import com.trippilot.itinerarygeneration.domain.ItineraryStatus
import com.trippilot.itinerarygeneration.domain.NewRevision
import com.trippilot.itinerarygeneration.domain.RevisionActor
import com.trippilot.itinerarygeneration.domain.RevisionKind
import com.trippilot.itinerarygeneration.domain.SolveMode
import com.trippilot.itinerarygeneration.domain.Violation
import com.trippilot.itinerarygeneration.domain.VisitSlot
import com.trippilot.trip.api.TripFacade
import com.trippilot.trip.api.TripPeriod
import io.kotest.assertions.throwables.shouldThrow
import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.collections.shouldContainExactly
import io.kotest.matchers.shouldBe
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

/**
 * 일정 편집 이력·되돌리기(TRIP-310).
 * 검증 축은 정본의 AC 그대로 — seq 단조(INV-U3-06) · 되돌리기가 과거를 지우지 않음(BR-U3-32) ·
 * 되돌려도 고정 블록 시각 불변(BR-U3-33) · 되돌리기 지점 없는 재생성 0(INV-U3-08).
 */
/** 콜백을 그대로 실행하는 no-op tx 매니저(단위 테스트용). */
private val REV_NOOP_TX = object : PlatformTransactionManager {
    override fun getTransaction(definition: TransactionDefinition?): TransactionStatus = SimpleTransactionStatus()
    override fun commit(status: TransactionStatus) {}
    override fun rollback(status: TransactionStatus) {}
}

class ItineraryRevisionServiceTest : StringSpec({

    val now = Instant.parse("2026-08-06T00:00:00Z")
    val clock = Clock.fixed(now, ZoneOffset.UTC)
    val acc = UUID.randomUUID()
    val tripId = UUID.randomUUID()
    val d1 = LocalDate.parse("2026-08-01")
    val hotel = UUID.randomUUID()   // 고정 블록(숙소)
    val cafe = UUID.randomUUID()

    class Revisions : ItineraryRevisionRepository {
        val stored = mutableListOf<ItineraryRevision>()
        override fun append(revision: NewRevision): ItineraryRevision {
            val next = (stored.filter { it.tripId == revision.tripId }.maxOfOrNull { it.seq } ?: 0) + 1
            return ItineraryRevision(
                UUID.randomUUID(), revision.tripId, revision.itineraryId, next, revision.actor, revision.kind,
                revision.summary, revision.detail, revision.snapshot, revision.createdAt,
            ).also { stored += it }
        }
        override fun findSummaries(tripId: UUID, limit: Int) =
            stored.filter { it.tripId == tripId }.sortedByDescending { it.seq }.take(limit)
                .map { ItineraryRevisionSummary(it.revisionId, it.seq, it.actor, it.kind, it.summary, it.detail, it.createdAt) }
        override fun existsForTrip(tripId: UUID) = stored.any { it.tripId == tripId }
        override fun findById(revisionId: UUID) = stored.firstOrNull { it.revisionId == revisionId }
    }

    class Itineraries(seed: Itinerary?) : ItineraryRepository {
        var current: Itinerary? = seed
        override fun save(itinerary: Itinerary) = itinerary.also { current = it }
        override fun findById(itineraryId: UUID) = current?.takeIf { it.itineraryId == itineraryId }
        override fun findByTrip(tripId: UUID) = listOfNotNull(current)
        override fun replaceForTrip(tripId: UUID, itinerary: Itinerary) = itinerary.also { current = it }
        override fun replaceIfCurrent(tripId: UUID, expectedItineraryId: UUID, itinerary: Itinerary) =
            true.also { current = itinerary }
        override fun findStalePartial(updatedBefore: Instant) = emptyList<Itinerary>()
    }

    val trips = object : TripFacade {
        override fun findPeriod(accountId: UUID, tripId: UUID) = if (accountId == acc) TripPeriod(d1, d1) else null
        override fun findGenerationContext(accountId: UUID, tripId: UUID) = null
    }

    fun slot(poi: UUID, start: String, end: String, fixed: Boolean = false, order: Int = 0) =
        VisitSlot.of(poi, null, order, LocalTime.parse(start), LocalTime.parse(end), isFixed = fixed)

    fun itinerary(slots: List<VisitSlot>, status: ItineraryStatus = ItineraryStatus.PLANNED, state: GenerationState = GenerationState.COMPLETE) =
        Itinerary.reconstitute(
            UUID.randomUUID(), tripId, status, SolveMode.FULL_AI, GenerationMode.FULLY_AI, false, state,
            listOf(ItineraryDay.of(d1, 0, slots)), now, now, null,
        )

    fun service(revs: Revisions, its: Itineraries) = ItineraryRevisionService(revs, its, trips, NoopValidateAgent(), REV_NOOP_TX, clock)

    "seq 는 1부터 단조 증가한다(INV-U3-06)" {
        val revs = Revisions()
        val base = itinerary(listOf(slot(cafe, "10:00", "11:00")))
        val svc = service(revs, Itineraries(base))
        svc.record(base, RevisionActor.AI, RevisionKind.BASELINE, "처음")
        svc.record(base, RevisionActor.USER, RevisionKind.EDIT, "수정1")
        svc.record(base, RevisionActor.USER, RevisionKind.EDIT, "수정2")

        revs.stored.map { it.seq } shouldContainExactly listOf(1, 2, 3)
    }

    "되돌리면 과거 리비전이 남고 새 리비전이 쌓인다(BR-U3-32 — 되돌리기의 되돌리기 가능)" {
        val revs = Revisions()
        val v1 = itinerary(listOf(slot(cafe, "10:00", "11:00")))
        val its = Itineraries(v1)
        val svc = service(revs, its)
        svc.record(v1, RevisionActor.AI, RevisionKind.BASELINE, "처음")
        val target = revs.stored.single()
        // 사용자가 편집해 상태가 달라진 뒤
        val v2 = itinerary(listOf(slot(cafe, "15:00", "16:00")))
        its.current = Itinerary.reconstitute(v1.itineraryId, tripId, ItineraryStatus.PLANNED, v1.solveMode, GenerationMode.FULLY_AI, false, GenerationState.COMPLETE, v2.days, now, now, null)
        svc.record(its.current!!, RevisionActor.USER, RevisionKind.EDIT, "수정")

        val restored = svc.restore(acc, tripId, target.revisionId)

        restored.days.single().slots.single().startAt shouldBe LocalTime.parse("10:00") // 과거 버전으로 복원
        revs.stored.map { it.kind } shouldContainExactly
            listOf(RevisionKind.BASELINE, RevisionKind.EDIT, RevisionKind.RESTORE) // 과거를 지우지 않는다
        revs.stored.map { it.seq } shouldContainExactly listOf(1, 2, 3)
    }

    "되돌려도 고정 블록 시각은 현행이 이긴다(BR-U3-33 · INV-U3-03)" {
        val revs = Revisions()
        // 과거 버전에는 숙소가 09:00 이었지만
        val old = itinerary(listOf(slot(hotel, "09:00", "10:00", fixed = true), slot(cafe, "13:00", "14:00", order = 1)))
        val its = Itineraries(old)
        val svc = service(revs, its)
        svc.record(old, RevisionActor.AI, RevisionKind.BASELINE, "처음")
        val target = revs.stored.single()
        // 현재는 숙소 고정 시각이 16:00 으로 바뀐 상태
        val nowFixed = itinerary(listOf(slot(hotel, "16:00", "17:00", fixed = true), slot(cafe, "20:00", "21:00", order = 1)))
        its.current = Itinerary.reconstitute(old.itineraryId, tripId, ItineraryStatus.PLANNED, old.solveMode, GenerationMode.FULLY_AI, false, GenerationState.COMPLETE, nowFixed.days, now, now, null)

        val restored = svc.restore(acc, tripId, target.revisionId)

        val slots = restored.days.single().slots.associateBy { it.sourcePoiId }
        slots.getValue(hotel).startAt shouldBe LocalTime.parse("16:00") // 고정 블록은 흔들리지 않는다
        slots.getValue(cafe).startAt shouldBe LocalTime.parse("13:00")  // 고정 아닌 슬롯은 복원값
    }

    "되돌리기 지점이 없으면 만들어 준다 — 리비전 없는 재생성 경로 0(INV-U3-08)" {
        val revs = Revisions()
        val base = itinerary(listOf(slot(cafe, "10:00", "11:00")))
        val svc = service(revs, Itineraries(base))

        svc.ensureRestorePoint(base)
        revs.stored.single().kind shouldBe RevisionKind.BASELINE

        svc.ensureRestorePoint(base) // 이미 있으면 중복해서 쌓지 않는다
        revs.stored.size shouldBe 1
    }

    "확정된 일정은 되돌릴 수 없다(409)" {
        val revs = Revisions()
        val base = itinerary(listOf(slot(cafe, "10:00", "11:00")), status = ItineraryStatus.CONFIRMED)
        val svc = service(revs, Itineraries(base))
        svc.record(base, RevisionActor.AI, RevisionKind.BASELINE, "처음")
        shouldThrow<ConflictDetected> { svc.restore(acc, tripId, revs.stored.single().revisionId) }
    }

    "생성 중(PARTIAL)에는 되돌릴 수 없다(409)" {
        val revs = Revisions()
        val base = itinerary(listOf(slot(cafe, "10:00", "11:00")), state = GenerationState.PARTIAL)
        val svc = service(revs, Itineraries(base))
        svc.record(base, RevisionActor.AI, RevisionKind.BASELINE, "처음")
        shouldThrow<ConflictDetected> { svc.restore(acc, tripId, revs.stored.single().revisionId) }
    }

    "타 계정이거나 없는 리비전이면 404" {
        val revs = Revisions()
        val base = itinerary(listOf(slot(cafe, "10:00", "11:00")))
        val svc = service(revs, Itineraries(base))
        svc.record(base, RevisionActor.AI, RevisionKind.BASELINE, "처음")

        shouldThrow<ResourceNotFound> { svc.restore(UUID.randomUUID(), tripId, revs.stored.single().revisionId) }
        shouldThrow<ResourceNotFound> { svc.restore(acc, tripId, UUID.randomUUID()) }
    }

    "다른 여행의 리비전을 이 여행에 복원할 수 없다(404)" {
        // **실재하는데 다른 여행 것**이어야 이 가드를 지난다 — 없는 id 로는 앞단 조회에서 걸려 가드를 밟지 못한다.
        // 이 여행은 내 것이라 소유권 검사도 통과하므로, 남는 방어선은 리비전의 여행 범위 확인뿐이다.
        val revs = Revisions()
        val mine = itinerary(listOf(slot(cafe, "10:00", "11:00")))
        val svc = service(revs, Itineraries(mine))
        val othersTrip = UUID.randomUUID()
        val others = Itinerary.reconstitute(
            UUID.randomUUID(), othersTrip, ItineraryStatus.PLANNED, SolveMode.FULL_AI, GenerationMode.FULLY_AI, false,
            GenerationState.COMPLETE, listOf(ItineraryDay.of(d1, 0, listOf(slot(cafe, "20:00", "21:00")))), now, now, null,
        )
        svc.record(others, RevisionActor.USER, RevisionKind.EDIT, "남의 여행")
        val foreign = revs.stored.single { it.tripId == othersTrip }

        shouldThrow<ResourceNotFound> { svc.restore(acc, tripId, foreign.revisionId) }
    }

    "AI 재검증이 실패해도 되돌리기는 500 이 되지 않는다 — 직전 위반 표시를 유지한 채 저장한다" {
        val revs = Revisions()
        // 현행 일정은 이미 위반이 표시된 상태
        val flagged = Itinerary.reconstitute(
            UUID.randomUUID(), tripId, ItineraryStatus.PLANNED, SolveMode.FULL_AI, GenerationMode.FULLY_AI, false,
            GenerationState.COMPLETE,
            listOf(
                ItineraryDay.of(
                    d1, 0,
                    listOf(
                        VisitSlot.of(
                            cafe, null, 0, LocalTime.parse("10:00"), LocalTime.parse("11:00"),
                            hasViolation = true, violationReason = "이동이 빠듯해요",
                        ),
                    ),
                ),
            ),
            now, now, null,
        )
        val its = Itineraries(flagged)
        val down = NoopValidateAgent(failure = RuntimeException("AI 다운"))
        val svc = ItineraryRevisionService(revs, its, trips, down, REV_NOOP_TX, clock)
        svc.record(flagged, RevisionActor.AI, RevisionKind.BASELINE, "처음")

        val restored = svc.restore(acc, tripId, revs.stored.single().revisionId)

        // 판정을 못 했다고 "깨끗하다"고 말하지 않는다 — 배지가 조용히 꺼지면 사용자는 문제를 못 본다.
        val s0 = restored.days.single().slots.single()
        s0.hasViolation shouldBe true
        s0.violationReason shouldBe "이동이 빠듯해요"
    }

    "되돌린 결과에도 위반 사유가 붙는다(배지만 켜면 화면이 이유를 못 그린다)" {
        val revs = Revisions()
        val v1 = itinerary(listOf(slot(cafe, "10:00", "11:00")))
        val its = Itineraries(v1)
        // 복원 결과를 재검증했더니 위반이 나온 상황 — 현행 고정 시각과 과거 배치의 조합은 솔버가 만든 적 없다.
        val agent = NoopValidateAgent(listOf(Violation("TRAVEL_TIME", 0, 0, "이동이 빠듯해요")))
        val svc = ItineraryRevisionService(revs, its, trips, agent, REV_NOOP_TX, clock)
        svc.record(v1, RevisionActor.AI, RevisionKind.BASELINE, "처음")

        val restored = svc.restore(acc, tripId, revs.stored.single().revisionId)

        val s0 = restored.days.single().slots.single()
        s0.hasViolation shouldBe true
        s0.violationReason shouldBe "이동이 빠듯해요"
    }
})
