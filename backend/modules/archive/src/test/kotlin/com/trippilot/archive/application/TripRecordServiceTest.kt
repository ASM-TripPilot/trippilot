package com.trippilot.archive.application

import com.trippilot.archive.domain.CheckSource
import com.trippilot.archive.domain.VisitCheck
import com.trippilot.archive.domain.VisitCheckRepository
import com.trippilot.archive.domain.VisitMemo
import com.trippilot.archive.domain.VisitMemoRepository
import com.trippilot.archive.domain.VisitPhotoMeta
import com.trippilot.archive.domain.VisitPhotoMetaRepository
import com.trippilot.changelog.api.ChangeLogEntryView
import com.trippilot.changelog.api.ChangeLogFacade
import com.trippilot.changelog.api.AppendChangeLog
import com.trippilot.changelog.api.ChangeSourceType
import com.trippilot.changelog.api.ItinerarySnapshotView
import com.trippilot.core.error.ResourceNotFound
import com.trippilot.itinerarygeneration.api.ItineraryPlanFacade
import com.trippilot.itinerarygeneration.api.PlannedSlotView
import com.trippilot.savedaccommodation.api.DayBaseStayView
import com.trippilot.savedaccommodation.api.TripBaseStayFacade
import com.trippilot.trip.api.TripFacade
import com.trippilot.trip.api.TripPeriod
import io.kotest.assertions.throwables.shouldThrow
import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.collections.shouldContainExactly
import io.kotest.matchers.shouldBe
import java.time.Instant
import java.time.LocalDate
import java.time.LocalTime
import java.util.UUID

/**
 * 3종 비교(BR-U5-01·08·25·26·27·28).
 *
 * 검증 축은 **저장하지 않는 것들**이다 — 미방문 판정과 숙소 귀속. 둘 다 저장하면 그 순간은 맞지만
 * 계획·숙소가 바뀌는 순간 조용히 어긋난다. 그래서 "바꿔 보고 따라오는지"를 직접 잰다.
 */
class TripRecordServiceTest : StringSpec({

    val acc = UUID.randomUUID()
    val tripId = UUID.randomUUID()
    val day1 = LocalDate.parse("2026-08-11")
    val day2 = LocalDate.parse("2026-08-12")
    val now = Instant.parse("2026-08-11T03:00:00Z")

    val trips = object : TripFacade {
        override fun findPeriod(accountId: UUID, tripId: UUID) =
            if (accountId == acc) TripPeriod(day1, day2) else null
        override fun findGenerationContext(accountId: UUID, tripId: UUID) = null
    }

    class Checks : VisitCheckRepository {
        val stored = mutableListOf<VisitCheck>()
        override fun save(check: VisitCheck) = check.also {
            stored.removeAll { s -> s.visitCheckId == check.visitCheckId }; stored += it
        }
        override fun findById(visitCheckId: UUID) = stored.firstOrNull { it.visitCheckId == visitCheckId }
        override fun findByTrip(tripId: UUID) = stored.filter { it.tripId == tripId }
        override fun findBySlot(tripId: UUID, slotKey: String) =
            stored.firstOrNull { it.tripId == tripId && it.slotKey == slotKey }
    }

    class Photos(private val counts: Map<UUID, Int> = emptyMap()) : VisitPhotoMetaRepository {
        override fun save(photo: VisitPhotoMeta) = photo
        override fun findByVisit(visitCheckId: UUID) = emptyList<VisitPhotoMeta>()
        override fun findById(visitPhotoMetaId: UUID): VisitPhotoMeta? = null
        override fun delete(visitPhotoMetaId: UUID) = false
        override fun countByVisits(visitCheckIds: Collection<UUID>) = counts.filterKeys { it in visitCheckIds }
    }

    class Memos(val stored: MutableSet<UUID> = mutableSetOf()) : VisitMemoRepository {
        override fun upsert(memo: VisitMemo) = memo.also { stored += it.visitCheckId }
        override fun find(visitCheckId: UUID): VisitMemo? = null
        override fun findVisitsWithMemo(visitCheckIds: Collection<UUID>) = stored.intersect(visitCheckIds.toSet())
        override fun delete(visitCheckId: UUID) = stored.remove(visitCheckId)
    }

    /** 변경 이력은 읽기만 한다 — 쓰기를 부르면 그 자리에서 드러나야 한다(BR-U5-29). */
    class ReadOnlyChangeLog(private val entries: List<ChangeLogEntryView> = emptyList()) : ChangeLogFacade {
        var askedLimit: Int? = null
        override fun append(command: AppendChangeLog) = error("U5 는 변경 이력을 쓰지 않는다(BR-U5-29).")
        override fun findTimeline(accountId: UUID, tripId: UUID, limit: Int): List<ChangeLogEntryView> {
            askedLimit = limit
            return entries
        }
    }

    fun plans(vararg slots: PlannedSlotView) = object : ItineraryPlanFacade {
        override fun findPlanSlots(accountId: UUID, tripId: UUID) = slots.toList()
    }

    fun bases(vararg days: DayBaseStayView) = object : TripBaseStayFacade {
        override fun findBaseStays(tripId: UUID, startDate: LocalDate, endDate: LocalDate) = days.toList()
    }

    fun slot(date: LocalDate, poi: UUID, order: Int, start: String = "10:00") = PlannedSlotView(
        slotKey = "$date#$poi", date = date, poiId = poi, orderIndex = order,
        startAt = LocalTime.parse(start), endAt = LocalTime.parse("11:30"), isFixed = false, endsNextDay = false,
    )

    fun arrived(checks: Checks, date: LocalDate, poi: UUID, at: String = "03:00") = checks.save(
        VisitCheck.arrive(tripId, "$date#$poi", poi, CheckSource.MANUAL, Instant.parse("${date}T${at}:00Z")),
    )

    // ── BR-U5-28 미방문은 저장하지 않고 파생한다 ────────────────────────
    "계획 5곳 · 실제 3곳이면 미방문 2곳이 파생으로 나온다 (저장 0)" {
        val pois = List(5) { UUID.randomUUID() }
        val checks = Checks()
        pois.take(3).forEach { arrived(checks, day1, it) }
        val svc = TripRecordService(
            trips, plans(*pois.mapIndexed { i, p -> slot(day1, p, i) }.toTypedArray()),
            checks, Photos(), Memos(), bases(), ReadOnlyChangeLog(),
        )

        val record = svc.compare(acc, tripId)

        val d = record.days.single { it.date == day1 }
        d.planned.size shouldBe 5
        d.actual.size shouldBe 3
        d.unvisitedSlotKeys shouldContainExactly pois.drop(3).map { "$day1#$it" }
        // 판정일 뿐 아무것도 쌓이지 않았다.
        checks.stored.size shouldBe 3
    }

    "계획이 바뀌면 미방문도 따라 바뀐다 — 저장돼 있었다면 옛 판정이 남는다" {
        val visited = UUID.randomUUID()
        val notYet = UUID.randomUUID()
        val checks = Checks()
        arrived(checks, day1, visited)

        val before = TripRecordService(
            trips, plans(slot(day1, visited, 0), slot(day1, notYet, 1)),
            checks, Photos(), Memos(), bases(), ReadOnlyChangeLog(),
        ).compare(acc, tripId).days.single().unvisitedSlotKeys
        before shouldContainExactly listOf("$day1#$notYet")

        // 계획에서 그 슬롯이 빠졌다 — 미방문도 사라져야 한다.
        val after = TripRecordService(
            trips, plans(slot(day1, visited, 0)),
            checks, Photos(), Memos(), bases(), ReadOnlyChangeLog(),
        ).compare(acc, tripId).days.single().unvisitedSlotKeys
        after shouldContainExactly emptyList()
    }

    // ── BR-U5-25·26·27 숙소 귀속도 파생이다 ─────────────────────────────
    "숙소가 바뀌면 같은 기록의 귀속이 따라 바뀐다 (파생이라는 증거)" {
        val poi = UUID.randomUUID()
        val checks = Checks()
        arrived(checks, day1, poi)
        val stayA = UUID.randomUUID()
        val stayB = UUID.randomUUID()

        fun withBase(stayId: UUID, name: String) = TripRecordService(
            trips, plans(slot(day1, poi, 0)), checks, Photos(), Memos(),
            bases(DayBaseStayView(day1, stayId, name)), ReadOnlyChangeLog(),
        ).compare(acc, tripId).days.single { it.date == day1 }

        withBase(stayA, "제주 숙소").baseStayName shouldBe "제주 숙소"
        // 같은 방문 기록인데 숙소만 바꿨다.
        withBase(stayB, "서귀포 숙소").baseStayName shouldBe "서귀포 숙소"
    }

    "등록 숙소가 없는 날은 날짜만으로 묶인다 (오류가 아니다)" {
        val poi = UUID.randomUUID()
        val checks = Checks()
        arrived(checks, day1, poi)
        val svc = TripRecordService(
            trips, plans(slot(day1, poi, 0)), checks, Photos(), Memos(), bases(), ReadOnlyChangeLog(),
        )

        val d = svc.compare(acc, tripId).days.single { it.date == day1 }

        d.baseStayId shouldBe null
        d.baseStayName shouldBe null
        d.actual.size shouldBe 1
    }

    // ── BR-U5-08 체류는 싣지 않는다 ────────────────────────────────────
    "개별 방문 응답에 체류 시간이 없다" {
        val poi = UUID.randomUUID()
        val checks = Checks()
        val v = arrived(checks, day1, poi)
        checks.save(v.complete(Instant.parse("2026-08-11T05:00:00Z"))) // 체류 120분이 산출되는 상태
        val svc = TripRecordService(
            trips, plans(slot(day1, poi, 0)), checks, Photos(), Memos(), bases(), ReadOnlyChangeLog(),
        )

        val visit = svc.compare(acc, tripId).days.single().actual.single()

        // 필드 자체가 없어야 한다 — 값이 0/null 인 것과 다르다.
        ActualVisitRecord::class.java.declaredFields.map { it.name }
            .none { it.contains("dwell", ignoreCase = true) } shouldBe true
        visit.completedAt shouldBe Instant.parse("2026-08-11T05:00:00Z")
    }

    // ── 즉석 방문·경계 ────────────────────────────────────────────────
    "즉석 방문은 계획에 없어도 그 날 실적에 들어간다 (계획을 만들지 않는다)" {
        val planned = UUID.randomUUID()
        val checks = Checks()
        arrived(checks, day1, planned)
        checks.save(VisitCheck.arrive(tripId, null, UUID.randomUUID(), CheckSource.MANUAL, Instant.parse("2026-08-11T04:00:00Z")))
        val svc = TripRecordService(
            trips, plans(slot(day1, planned, 0)), checks, Photos(), Memos(), bases(), ReadOnlyChangeLog(),
        )

        val d = svc.compare(acc, tripId).days.single { it.date == day1 }

        d.actual.count { it.spontaneous } shouldBe 1
        d.planned.size shouldBe 1 // 즉석 방문이 계획을 늘리지 않았다(INV-U5-02)
        d.unvisitedSlotKeys shouldContainExactly emptyList()
    }

    "사진 개수·메모 유무가 실적에 함께 온다" {
        val poi = UUID.randomUUID()
        val checks = Checks()
        val v = arrived(checks, day1, poi)
        val svc = TripRecordService(
            trips, plans(slot(day1, poi, 0)), checks,
            Photos(mapOf(v.visitCheckId to 3)), Memos(mutableSetOf(v.visitCheckId)), bases(), ReadOnlyChangeLog(),
        )

        val visit = svc.compare(acc, tripId).days.single().actual.single()

        visit.photoCount shouldBe 3
        visit.hasMemo shouldBe true
    }

    "변경 이력은 읽기만 하고 상한을 그대로 넘긴다(BR-U5-29)" {
        val checks = Checks()
        val log = ReadOnlyChangeLog()
        val svc = TripRecordService(trips, plans(), checks, Photos(), Memos(), bases(), log)

        svc.compare(acc, tripId, changeLimit = 7).changes shouldBe emptyList()

        log.askedLimit shouldBe 7 // 소유 판정·정렬은 소유 모듈이 한다 — 여기서 되풀이하지 않는다
    }

    "타 계정이면 404 — 존재를 알리지 않는다" {
        val svc = TripRecordService(trips, plans(), Checks(), Photos(), Memos(), bases(), ReadOnlyChangeLog())
        shouldThrow<ResourceNotFound> { svc.compare(UUID.randomUUID(), tripId) }
    }
})
