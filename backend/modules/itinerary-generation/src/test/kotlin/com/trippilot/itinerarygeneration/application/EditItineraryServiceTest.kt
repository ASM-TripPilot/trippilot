package com.trippilot.itinerarygeneration.application

import com.trippilot.changelog.api.AppendChangeLog
import com.trippilot.changelog.api.ChangeLogFacade
import com.trippilot.changelog.api.ChangeSourceType
import com.trippilot.core.error.ConflictDetected
import com.trippilot.core.error.ResourceNotFound
import com.trippilot.itinerarygeneration.domain.Itinerary
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
/** 편집이 남긴 변경 이력을 관찰하는 Fake — 실제 영속은 change-log 모듈 IT 가 본다. */
private class RecordingChangeLog : ChangeLogFacade {
    val appended = mutableListOf<AppendChangeLog>()
    override fun append(command: AppendChangeLog) { appended += command }
}

class EditItineraryServiceTest : StringSpec({

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

    "편집하면 변경 이력이 전후 스냅숏·사유와 함께 남는다(US-PLANB-09)" {
        val repo = repoWith(current())
        val log = RecordingChangeLog()
        EditItineraryService(trips(true), repo, EditFakeAgent(), log, NOOP_TX, clock)
            .edit(acc, tripId, editReq.copy(reason = "비 예보로 실내로 변경"))

        val entry = log.appended.single()
        entry.tripId shouldBe tripId
        entry.actor shouldBe acc.toString()      // 변경 주체 = 편집한 계정
        entry.sourceType shouldBe ChangeSourceType.MANUAL
        entry.reason shouldBe "비 예보로 실내로 변경"
        // 전후가 실제로 다른 상태여야 이력이 의미를 갖는다
        entry.before shouldNotBe entry.after
        entry.after.days.single().slots.map { it.poiId } shouldBe editReq.days.single().slots.map { it.poiId }
    }

    "사유 없이 편집해도 이력은 남는다(reason 은 선택)" {
        val log = RecordingChangeLog()
        EditItineraryService(trips(true), repoWith(current()), EditFakeAgent(), log, NOOP_TX, clock)
            .edit(acc, tripId, editReq)
        log.appended.single().reason shouldBe null
    }

    "편집이 거부되면 이력도 남지 않는다(확정 일정)" {
        val base = current()
        val snapshots = base.days.flatMap { it.slots }.associate { it.sourcePoiId to UUID.randomUUID() }
        val repo = repoWith(base.confirm(snapshots, clock.instant()))
        val log = RecordingChangeLog()
        shouldThrow<ConflictDetected> {
            EditItineraryService(trips(true), repo, EditFakeAgent(), log, NOOP_TX, clock).edit(acc, tripId, editReq)
        }
        log.appended shouldBe emptyList()
    }

    "편집하면 새 배열로 교체 + 위반 없으면 hasViolation=false" {
        val repo = repoWith(current())
        val svc = EditItineraryService(trips(true), repo, EditFakeAgent(), RecordingChangeLog(), NOOP_TX, clock)
        val result = svc.edit(acc, tripId, editReq)
        val slots = result.days.single().slots
        slots.map { it.sourcePoiId } shouldBe listOf(poiB, poiA) // 편집 순서
        slots.all { !it.hasViolation } shouldBe true
    }

    "validate 위반을 해당 슬롯 hasViolation 으로 표시(비차단 저장)" {
        val repo = repoWith(current())
        val svc = EditItineraryService(trips(true), repo, EditFakeAgent(listOf(Violation("TRAVEL_TIME", 0, 1, null))), RecordingChangeLog(), NOOP_TX, clock)
        val slots = svc.edit(acc, tripId, editReq).days.single().slots
        slots[0].hasViolation shouldBe false
        slots[1].hasViolation shouldBe true // day0/slot1 위반
    }

    "자정 넘김 슬롯을 편집해도 플래그가 보존된다(회귀)" {
        val repo = repoWith(current())
        val midnightEdit = EditItinerary(
            listOf(EditDay(day, listOf(EditSlot(poiA, LocalTime.parse("23:00"), LocalTime.parse("01:00"), isFixed = false, endsNextDay = true)))),
        )
        val slot = EditItineraryService(trips(true), repo, EditFakeAgent(), RecordingChangeLog(), NOOP_TX, clock)
            .edit(acc, tripId, midnightEdit).days.single().slots.single()
        slot.endsNextDay shouldBe true
        slot.endAt shouldBe LocalTime.parse("01:00")
    }

    "확정된 일정은 편집 불가 409" {
        val repo = repoWith(current { it.confirm(clock.instant()) })
        shouldThrow<ConflictDetected> { EditItineraryService(trips(true), repo, EditFakeAgent(), RecordingChangeLog(), NOOP_TX, clock).edit(acc, tripId, editReq) }
    }

    "생성된 일정 없으면 404" {
        shouldThrow<ResourceNotFound> { EditItineraryService(trips(true), EditFakeItineraries(), EditFakeAgent(), RecordingChangeLog(), NOOP_TX, clock).edit(acc, tripId, editReq) }
    }

    "미소유 여행이면 404" {
        val repo = repoWith(current())
        shouldThrow<ResourceNotFound> { EditItineraryService(trips(false), repo, EditFakeAgent(), RecordingChangeLog(), NOOP_TX, clock).edit(acc, tripId, editReq) }
    }
})
