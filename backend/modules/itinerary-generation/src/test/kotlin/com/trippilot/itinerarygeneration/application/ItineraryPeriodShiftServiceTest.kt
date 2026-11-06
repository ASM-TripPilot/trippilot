package com.trippilot.itinerarygeneration.application

import com.trippilot.itinerarygeneration.domain.GenerationMode
import com.trippilot.itinerarygeneration.domain.GenerationState
import com.trippilot.itinerarygeneration.domain.Itinerary
import com.trippilot.itinerarygeneration.domain.ItineraryDay
import com.trippilot.itinerarygeneration.domain.ItineraryRepository
import com.trippilot.itinerarygeneration.domain.ItineraryRevision
import com.trippilot.itinerarygeneration.domain.ItineraryRevisionRepository
import com.trippilot.itinerarygeneration.domain.ItineraryRevisionSummary
import com.trippilot.itinerarygeneration.domain.NewRevision
import com.trippilot.itinerarygeneration.domain.ItineraryStatus
import com.trippilot.itinerarygeneration.domain.ScoringSignal
import com.trippilot.itinerarygeneration.domain.SolveMode
import com.trippilot.itinerarygeneration.domain.Violation
import com.trippilot.itinerarygeneration.domain.VisitSlot
import com.trippilot.trip.api.OwnedTripPeriod
import com.trippilot.trip.api.TripFacade
import com.trippilot.trip.api.TripOwnerFacade
import com.trippilot.trip.api.TripPeriod
import io.kotest.core.spec.style.StringSpec
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

private val NOOP_TX = object : PlatformTransactionManager {
    override fun getTransaction(definition: TransactionDefinition?): TransactionStatus = SimpleTransactionStatus()
    override fun commit(status: TransactionStatus) {}
    override fun rollback(status: TransactionStatus) {}
}

/** 기간 이동의 일정 쪽(TRIP-1789) — 판정 재료 · 이동 · 뒤늦은 재검증. */
class ItineraryPeriodShiftServiceTest : StringSpec({

    val now = Instant.parse("2026-07-01T00:00:00Z")
    val clock = Clock.fixed(now, ZoneOffset.UTC)
    val acc = UUID.randomUUID()
    val tripId = UUID.randomUUID()
    val poi = UUID.randomUUID()
    val date = LocalDate.parse("2026-08-01")

    class Itineraries(var current: Itinerary?) : ItineraryRepository {
        var writes = 0
        /** 잠금 뒤에 보이는 일정 — 재검증(외부 호출) 동안 커밋된 쓰기를 흉내 낸다. */
        var lockedView: Itinerary? = null
        override fun save(itinerary: Itinerary) = itinerary.also { current = it; writes++ }
        override fun findById(itineraryId: UUID) = current?.takeIf { it.itineraryId == itineraryId }
        override fun findByTrip(tripId: UUID) = listOfNotNull(current)
        override fun replaceForTrip(tripId: UUID, itinerary: Itinerary) = save(itinerary)
        override fun replaceIfCurrent(tripId: UUID, expectedItineraryId: UUID, itinerary: Itinerary) = true.also { save(itinerary) }
        override fun findStalePartial(updatedBefore: Instant) = emptyList<Itinerary>()
        override fun lockForTrip(tripId: UUID) = lockedView ?: current
        override fun deleteForTrip(tripId: UUID) { current = null; writes++ }
    }

    class Revisions : ItineraryRevisionRepository {
        val stored = mutableListOf<NewRevision>()
        override fun append(revision: NewRevision): ItineraryRevision {
            stored += revision
            return ItineraryRevision(UUID.randomUUID(), revision.tripId, revision.itineraryId, stored.size, revision.actor, revision.kind, revision.summary, revision.detail, revision.snapshot, revision.createdAt)
        }
        override fun findSummaries(tripId: UUID, limit: Int) = emptyList<ItineraryRevisionSummary>()
        override fun existsForTrip(tripId: UUID) = stored.isNotEmpty()
        override fun findById(revisionId: UUID): ItineraryRevision? = null
    }

    val trips = object : TripFacade {
        override fun findPeriod(accountId: UUID, tripId: UUID) = TripPeriod(date, date)
        override fun findGenerationContext(accountId: UUID, tripId: UUID) = null
    }
    val owners = object : TripOwnerFacade {
        override fun findOwnedPeriod(tripId: UUID) = OwnedTripPeriod(acc, date, date)
    }

    fun itinerary(flagged: Boolean = false, state: GenerationState = GenerationState.COMPLETE) = Itinerary.reconstitute(
        UUID.randomUUID(), tripId, ItineraryStatus.PLANNED, SolveMode.FULL_AI, GenerationMode.FULLY_AI, false, state,
        listOf(
            ItineraryDay.of(
                date, 0,
                listOf(
                    VisitSlot.of(
                        poi, UUID.randomUUID(), 0, LocalTime.of(10, 0), LocalTime.of(11, 0), hasViolation = flagged,
                        distanceRange = "약 1km", placementReason = "이유", violationReason = if (flagged) "옛 사유" else null,
                    ),
                ),
            ),
        ),
        now, now, null, emptyList(), ScoringSignal.UNKNOWN,
    )

    fun service(
        its: Itineraries,
        agent: NoopValidateAgent = NoopValidateAgent(),
        sessions: FakeGenerationSessions = FakeGenerationSessions(),
        visited: Boolean = false,
        revisions: Revisions = Revisions(),
    ) = ItineraryPeriodShiftService(
        its, sessions, { visited }, owners, agent, modesOnlyRepairContexts(trips),
        ItineraryRevisionService(revisions, its, trips, agent, NOOP_TX, clock, modesOnlyRepairContexts(trips)), NOOP_TX, clock,
    )

    val closed = Violation("OPENING_HOURS", 0, 0, "0요일 휴무")

    "판정 재료 — 일정·생성 중(PARTIAL)·방문 기록" {
        service(Itineraries(null)).lockForPeriodChange(acc, tripId).hasItinerary shouldBe false
        service(Itineraries(itinerary())).lockForPeriodChange(acc, tripId).generating shouldBe false
        service(Itineraries(itinerary(state = GenerationState.PARTIAL))).lockForPeriodChange(acc, tripId).generating shouldBe true
        service(Itineraries(itinerary()), visited = true).lockForPeriodChange(acc, tripId).hasVisits shouldBe true
    }

    "민 일정이 저장된다 — 동결·표시값 그대로, 날짜만" {
        val before = itinerary()
        val its = Itineraries(before)

        service(its).shiftDates(tripId, 3)

        val day = its.current!!.days.single()
        day.date shouldBe date.plusDays(3)
        day.slots.single().poiSnapshotId shouldBe before.days.single().slots.single().poiSnapshotId
        day.slots.single().placementReason shouldBe "이유"
    }

    "일정이 없으면 옮길 것도 없다" {
        val its = Itineraries(null)
        service(its).shiftDates(tripId, 3)
        its.writes shouldBe 0
    }

    "버리기 — 일정이 사라지고 버린 내용이 되돌리기 목록에 남는다(INV-U3-08)" {
        val its = Itineraries(itinerary())
        val revisions = Revisions()

        service(its, revisions = revisions).discard(tripId)

        its.current shouldBe null
        revisions.stored.single().snapshot.days.single().date shouldBe date
    }

    "버리기 — 일정이 없으면 이력도 안 남긴다" {
        val revisions = Revisions()
        service(Itineraries(null), revisions = revisions).discard(tripId)
        revisions.stored.size shouldBe 0
    }

    "재검증 — 새 요일의 휴무가 표시되고 다른 값은 그대로다" {
        val its = Itineraries(itinerary())

        service(its, NoopValidateAgent(listOf(closed))).revalidate(tripId)

        val slot = its.current!!.days.single().slots.single()
        slot.hasViolation shouldBe true
        slot.violationReason shouldBe ViolationText.reasonOf(listOf(closed))
        slot.distanceRange shouldBe "약 1km"
    }

    "재검증 — 옛 요일의 휴무 표시는 위반이 없으면 꺼진다" {
        val its = Itineraries(itinerary(flagged = true))

        service(its).revalidate(tripId)

        its.current!!.days.single().slots.single().hasViolation shouldBe false
        its.current!!.days.single().slots.single().violationReason shouldBe null
    }

    "재검증 — AI 불통이면 직전 표시를 잇는다(깨끗해졌다고 말하지 않는다)" {
        val its = Itineraries(itinerary(flagged = true))

        service(its, NoopValidateAgent(failure = RuntimeException("불통"))).revalidate(tripId)

        its.writes shouldBe 0
        its.current!!.days.single().slots.single().hasViolation shouldBe true
    }

    "재검증 — 그 사이 일정이 바뀌었으면 쓰지 않는다" {
        val its = Itineraries(itinerary())
        its.lockedView = itinerary()

        service(its, NoopValidateAgent(listOf(closed))).revalidate(tripId)

        its.writes shouldBe 0
    }

    "재검증 — 같은 내용이면 쓰지 않는다(재배달 멱등)" {
        val its = Itineraries(itinerary())

        service(its).revalidate(tripId)

        its.writes shouldBe 0
    }

    "재검증 — 생성 중이면 건드리지 않는다" {
        val its = Itineraries(itinerary(state = GenerationState.PARTIAL))

        service(its, NoopValidateAgent(listOf(closed))).revalidate(tripId)

        its.writes shouldBe 0
    }
})
