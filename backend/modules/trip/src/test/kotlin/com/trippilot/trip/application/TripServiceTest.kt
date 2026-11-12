package com.trippilot.trip.application

import com.trippilot.core.error.ConflictDetected
import com.trippilot.core.error.ErrorCode
import com.trippilot.core.error.ResourceNotFound
import com.trippilot.core.error.ValidationFailed
import com.trippilot.trip.api.event.TripPeriodChanged
import com.trippilot.trip.domain.MustVisit
import com.trippilot.trip.domain.MustVisitRepository
import com.trippilot.trip.domain.MustVisitType
import com.trippilot.trip.domain.Trip
import com.trippilot.trip.domain.TripPeriodShiftPort
import com.trippilot.trip.domain.TripPlanState
import com.trippilot.placedata.api.DestinationCheck
import com.trippilot.placedata.api.DestinationFacade
import com.trippilot.placedata.api.RegionCenter
import com.trippilot.placedata.api.RegionLookupFacade
import com.trippilot.trip.domain.TripDestination
import com.trippilot.trip.domain.TripRepository
import io.kotest.assertions.throwables.shouldThrow
import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.shouldBe
import io.kotest.matchers.string.shouldContain
import io.kotest.property.Arb
import io.kotest.property.arbitrary.int
import io.kotest.property.checkAll
import java.time.Clock
import java.time.Instant
import java.time.LocalDate
import java.time.LocalTime
import java.time.ZoneOffset
import java.util.UUID

private class FakeRepo : TripRepository {
    val store = mutableMapOf<UUID, Trip>()
    override fun save(trip: Trip) = trip.also { store[it.tripId] = it }
    override fun findById(tripId: UUID) = store[tripId]
    override fun findByAccount(accountId: UUID) = store.values.filter { it.accountId == accountId }
}

/** 발행만 삼키는 싱크 — 발행 여부는 삭제 스펙이 따로 본다(TRIP-1061). */
private object NoTripEvents : com.trippilot.core.event.DomainEventPublisher {
    override fun publish(event: com.trippilot.core.event.DomainEvent) = Unit
}

/** 발행한 사건을 모은다 — 기간 변경 사건의 발행 여부·내용을 보는 스펙용(TRIP-1758). */
private class RecordingTripEvents : com.trippilot.core.event.DomainEventPublisher {
    val published = mutableListOf<com.trippilot.core.event.DomainEvent>()
    override fun publish(event: com.trippilot.core.event.DomainEvent) {
        published += event
    }
}

/** 일정 쪽 대역 — [state] 로 답하고 민 칸수를 모은다. 기본은 일정 없는 여행. */
private class FakePlan(var state: TripPlanState = TripPlanState(false, false, false)) : TripPeriodShiftPort {
    val shifted = mutableListOf<Long>()
    val discarded = mutableListOf<Pair<LocalDate, LocalDate>>()
    override fun lockPlan(accountId: UUID, tripId: UUID) = state
    override fun shiftDates(tripId: UUID, days: Long) { shifted += days }
    override fun discardPlan(tripId: UUID, startDate: LocalDate, endDate: LocalDate) {
        discarded += startDate to endDate
        state = state.copy(hasItinerary = false)
    }
}

private class PeriodMustVisits : MustVisitRepository {
    val store = linkedMapOf<UUID, MustVisit>()
    override fun save(mustVisit: MustVisit) = mustVisit.also { store[it.mustVisitId] = it }
    override fun findByTrip(tripId: UUID) = store.values.filter { it.tripId == tripId }
    override fun findById(mustVisitId: UUID) = store[mustVisitId]
    override fun existsByTripAndSourcePoi(tripId: UUID, sourcePoiId: UUID) = false
    override fun delete(mustVisit: MustVisit) { store.remove(mustVisit.mustVisitId) }
}

class TripServiceTest : StringSpec({

    val clock = Clock.fixed(Instant.parse("2026-07-26T00:00:00Z"), ZoneOffset.UTC)
    val acc = UUID.randomUUID()
    val other = UUID.randomUUID()

    fun cmd(
        start: String = "2026-08-01", end: String = "2026-08-04", party: Int = 2,
        dests: List<TripDestination> = listOf(TripDestination(0, "제주", 3)),
    ) = CreateTripCommand(null, LocalDate.parse(start), LocalDate.parse(end), party, null, null, mapOf("pace" to "알차게"), dests)

    "생성 후 소유자 조회·목록(제목 자동생성·취향 동결)" {
        val svc = TripService(FakeRepo(), FakeDomestic(), FakeRegions(), NoTripEvents, clock, FakePlan(), PeriodMustVisits())
        val t = svc.create(acc, cmd())
        t.title shouldBe "제주 여행"
        t.preferenceSnapshot["pace"] shouldBe "알차게"
        svc.get(acc, t.tripId).party shouldBe 2
        svc.list(acc).size shouldBe 1
    }

    "타 계정 리소스는 404" {
        val svc = TripService(FakeRepo(), FakeDomestic(), FakeRegions(), NoTripEvents, clock, FakePlan(), PeriodMustVisits())
        val t = svc.create(acc, cmd())
        shouldThrow<ResourceNotFound> { svc.get(other, t.tripId) }
    }

    "국내 밖 목적지는 400(INV-U1-12)" {
        val svc = TripService(FakeRepo(), FakeDomestic(), FakeRegions(), NoTripEvents, clock, FakePlan(), PeriodMustVisits())
        shouldThrow<ValidationFailed> { svc.create(acc, cmd(dests = listOf(TripDestination(0, "도쿄", 2)))) }
    }

    // 이전 구현은 지역명 28개와 문자열 일치를 봤다 — 아래가 전부 막혔다(실측).
    "목록에 없던 시·군·구도 국내로 통과한다" {
        val svc = TripService(FakeRepo(), FakeDomestic(), FakeRegions(), NoTripEvents, clock, FakePlan(), PeriodMustVisits())
        listOf("천안", "속초시", "사하구").forEach { region ->
            svc.create(acc, cmd(dests = listOf(TripDestination(0, region, 2)))).tripId
        }
    }

    /**
     * **정책이 바뀐 자리다(TRIP-360).** 예전에는 확인 못 하면 통과시켰다 — 지오코딩이 유일한 기준이라
     * 벤더 장애가 곧 전면 차단이었기 때문이다. 이제 정상 목적지는 카탈로그에서 끝나 외부를 타지 않으므로,
     * "확인 못 함"까지 온 값은 어차피 지원하지 않는 이름이다. 거절하되 사유를 그렇게 말한다.
     *
     * 벤더 장애가 정상 사용자를 막지 않는다는 보장은 위 "목록에 없던 시·군·구도 통과한다" 가 맡는다 —
     * 그쪽이 카탈로그 경로라 외부를 부르지 않는다.
     */
    "확인하지 못한 목적지는 거절한다" {
        val svc = TripService(FakeRepo(), FakeDomestic(down = true), FakeRegions(), NoTripEvents, clock, FakePlan(), PeriodMustVisits())
        val e = shouldThrow<ValidationFailed> {
            svc.create(acc, cmd(dests = listOf(TripDestination(0, "어딘가", 2))))
        }
        // 문구가 사유를 구분해야 한다 — "국내만 지원해요" 로 뭉치면 사용자는 무엇을 고칠지 모른다.
        e.fieldErrors.single().reason shouldContain "확인하지 못했어요"
    }

    "거절 문구가 사유별로 갈린다" {
        val svc = TripService(FakeRepo(), FakeDomestic(), FakeRegions(), NoTripEvents, clock, FakePlan(), PeriodMustVisits())
        val e = shouldThrow<ValidationFailed> {
            svc.create(acc, cmd(dests = listOf(TripDestination(0, "도쿄", 2))))
        }
        e.fieldErrors.single().reason shouldContain "국내 여행만"
    }

    "여러 목적지 중 하나만 국외여도 막는다" {
        val svc = TripService(FakeRepo(), FakeDomestic(), FakeRegions(), NoTripEvents, clock, FakePlan(), PeriodMustVisits())
        shouldThrow<ValidationFailed> {
            svc.create(acc, cmd(dests = listOf(TripDestination(0, "제주", 1), TripDestination(1, "도쿄", 1))))
        }
    }

    "종료일 < 시작일은 400(INV-U1-11)" {
        val svc = TripService(FakeRepo(), FakeDomestic(), FakeRegions(), NoTripEvents, clock, FakePlan(), PeriodMustVisits())
        shouldThrow<ValidationFailed> { svc.create(acc, cmd(start = "2026-08-04", end = "2026-08-01")) }
    }

    "도시 박수 합이 기간 초과면 400(INV-U1-14)" {
        val svc = TripService(FakeRepo(), FakeDomestic(), FakeRegions(), NoTripEvents, clock, FakePlan(), PeriodMustVisits())
        // 3박4일인데 제주 3 + 부산 2 = 5박 > 3
        shouldThrow<ValidationFailed> {
            svc.create(acc, cmd(dests = listOf(TripDestination(0, "제주", 3), TripDestination(1, "부산", 2))))
        }
    }

    "편집은 가변필드 대체" {
        val svc = TripService(FakeRepo(), FakeDomestic(), FakeRegions(), NoTripEvents, clock, FakePlan(), PeriodMustVisits())
        val t = svc.create(acc, cmd())
        val edited = svc.edit(acc, t.tripId, EditTripCommand("내 여행", LocalDate.parse("2026-08-01"), LocalDate.parse("2026-08-03"), 4, null, null, listOf(TripDestination(0, "부산", 2))))
        edited.title shouldBe "내 여행"
        edited.party shouldBe 4
        edited.destinations.single().region shouldBe "부산"
    }

    // ── 기간 변경 사건(TRIP-1758) ───────────────────────────────────────────────
    // 알림 예약 같은 파생물이 새 기간으로 다시 서려면 편집이 기간을 바꿨다는 사실이 나가야 한다.
    fun edit(
        start: String, end: String, title: String? = "내 여행", party: Int = 2,
        dests: List<TripDestination> = listOf(TripDestination(0, "제주", 3)),
    ) = EditTripCommand(title, LocalDate.parse(start), LocalDate.parse(end), party, null, null, dests)

    // ---- 기간 변경 = 일정째 날짜만 이동(TRIP-1789). 시계는 2026-07-26 09:00 KST.
    val withItinerary = TripPlanState(hasItinerary = true, generating = false, hasVisits = false)

    "일정 있는 여행의 기간을 이틀 뒤로 — 일정·거점이 2칸, 날짜 고정 꼭 갈 곳만 이틀 밀린다" {
        val plan = FakePlan(withItinerary)
        val visits = PeriodMustVisits()
        val svc = TripService(FakeRepo(), FakeDomestic(), FakeRegions(), NoTripEvents, clock, plan, visits)
        val t = svc.create(acc, cmd(start = "2026-08-01", end = "2026-08-04"))
        val fixed = visits.save(MustVisit.add(t.tripId, UUID.randomUUID(), UUID.randomUUID(), MustVisitType.FIXED, LocalDate.parse("2026-08-02"), LocalTime.of(10, 0), null, clock.instant()))
        val anytime = visits.save(MustVisit.add(t.tripId, UUID.randomUUID(), UUID.randomUUID(), MustVisitType.ANYTIME, null, null, null, clock.instant()))

        val saved = svc.edit(acc, t.tripId, edit("2026-08-03", "2026-08-06"))

        saved.startDate shouldBe LocalDate.parse("2026-08-03")
        plan.shifted shouldBe listOf(2L)
        visits.store.getValue(fixed.mustVisitId).fixedDate shouldBe LocalDate.parse("2026-08-04")
        visits.store.getValue(fixed.mustVisitId).fixedStart shouldBe LocalTime.of(10, 0)
        visits.store.getValue(anytime.mustVisitId).fixedDate shouldBe null
    }

    "일정 있는 여행의 일수가 바뀌면 409 — 아무 날짜도 안 바뀐다" {
        val plan = FakePlan(withItinerary)
        val repo = FakeRepo()
        val events = RecordingTripEvents()
        val svc = TripService(repo, FakeDomestic(), FakeRegions(), events, clock, plan, PeriodMustVisits())
        val t = svc.create(acc, cmd(start = "2026-08-01", end = "2026-08-04"))

        shouldThrow<ConflictDetected> { svc.edit(acc, t.tripId, edit("2026-08-01", "2026-08-05")) }.errorCode shouldBe ErrorCode.TRIP_PERIOD_LENGTH_CHANGED

        plan.shifted shouldBe emptyList()
        events.published shouldBe emptyList()
        repo.store.getValue(t.tripId).endDate shouldBe LocalDate.parse("2026-08-04")
    }

    "시작한 여행은 기간을 못 옮긴다 409 — 시작일 당일도 시작이다(KST)" {
        val plan = FakePlan(withItinerary)
        val svc = TripService(FakeRepo(), FakeDomestic(), FakeRegions(), NoTripEvents, clock, plan, PeriodMustVisits())
        val t = svc.create(acc, cmd(start = "2026-07-26", end = "2026-07-29"))

        shouldThrow<ConflictDetected> { svc.edit(acc, t.tripId, edit("2026-07-28", "2026-07-31")) }.errorCode shouldBe ErrorCode.TRIP_PERIOD_STARTED
        plan.shifted shouldBe emptyList()
    }

    "시작 전이어도 방문 기록이 있으면 409 — 옛 날짜 슬롯 키의 기록이 고아가 된다" {
        val plan = FakePlan(withItinerary.copy(hasVisits = true))
        val svc = TripService(FakeRepo(), FakeDomestic(), FakeRegions(), NoTripEvents, clock, plan, PeriodMustVisits())
        val t = svc.create(acc, cmd(start = "2026-08-01", end = "2026-08-04"))

        shouldThrow<ConflictDetected> { svc.edit(acc, t.tripId, edit("2026-08-03", "2026-08-06")) }.errorCode shouldBe ErrorCode.TRIP_PERIOD_STARTED
    }

    "일정 생성 중이면 409 — 2차가 옛 날짜로 이어붙인다" {
        val plan = FakePlan(TripPlanState(hasItinerary = false, generating = true, hasVisits = false))
        val svc = TripService(FakeRepo(), FakeDomestic(), FakeRegions(), NoTripEvents, clock, plan, PeriodMustVisits())
        val t = svc.create(acc, cmd(start = "2026-08-01", end = "2026-08-04"))

        shouldThrow<ConflictDetected> { svc.edit(acc, t.tripId, edit("2026-08-03", "2026-08-06")) }.errorCode shouldBe ErrorCode.TRIP_PERIOD_GENERATING
    }

    "일정이 없으면 시작 뒤에도 고칠 수 있다 — 오늘 출발로 만든 여행을 위저드에서 되돌아가 고치는 경로" {
        val plan = FakePlan()
        val svc = TripService(FakeRepo(), FakeDomestic(), FakeRegions(), NoTripEvents, clock, plan, PeriodMustVisits())
        val t = svc.create(acc, cmd(start = "2026-07-26", end = "2026-07-29"))

        svc.edit(acc, t.tripId, edit("2026-07-27", "2026-07-30")).startDate shouldBe LocalDate.parse("2026-07-27")
        plan.shifted shouldBe listOf(1L)
    }

    "일정이 없고 일수가 바뀌면 거점·꼭 갈 곳을 옮기지 않는다 — 옮길 칸수가 정해지지 않는다" {
        val plan = FakePlan()
        val svc = TripService(FakeRepo(), FakeDomestic(), FakeRegions(), NoTripEvents, clock, plan, PeriodMustVisits())
        val t = svc.create(acc, cmd(start = "2026-08-01", end = "2026-08-04"))

        svc.edit(acc, t.tripId, edit("2026-08-02", "2026-08-06")).endDate shouldBe LocalDate.parse("2026-08-06")
        plan.shifted shouldBe emptyList()
    }

    "기간이 그대로면 일정을 잠그지도 옮기지도 않는다" {
        val plan = object : TripPeriodShiftPort {
            override fun lockPlan(accountId: UUID, tripId: UUID) = error("기간이 그대로인데 일정을 잠갔다")
            override fun shiftDates(tripId: UUID, days: Long) = error("기간이 그대로인데 일정을 옮겼다")
            override fun discardPlan(tripId: UUID, startDate: LocalDate, endDate: LocalDate) = error("기간이 그대로인데 일정을 버렸다")
        }
        val svc = TripService(FakeRepo(), FakeDomestic(), FakeRegions(), NoTripEvents, clock, plan, PeriodMustVisits())
        val t = svc.create(acc, cmd(start = "2026-08-01", end = "2026-08-04"))

        svc.edit(acc, t.tripId, edit("2026-08-01", "2026-08-04", title = "새 이름")).title shouldBe "새 이름"
    }

    // ---- 일수 변경 = 같은 여행에서 일정만 다시(사용자 결정 2026-11-06)
    "버리기 — 일수가 달라도 일정을 버리고 기간을 바꾼다. 밀지 않는다" {
        val plan = FakePlan(withItinerary)
        val svc = TripService(FakeRepo(), FakeDomestic(), FakeRegions(), NoTripEvents, clock, plan, PeriodMustVisits())
        val t = svc.create(acc, cmd(start = "2026-08-01", end = "2026-08-04"))

        val saved = svc.edit(acc, t.tripId, edit("2026-08-03", "2026-08-09").copy(discardItinerary = true))

        saved.endDate shouldBe LocalDate.parse("2026-08-09")
        plan.discarded shouldBe listOf(LocalDate.parse("2026-08-03") to LocalDate.parse("2026-08-09"))
        plan.shifted shouldBe emptyList()
    }

    "버리기 — 새 기간 밖 고정 꼭 갈 곳은 장소를 남기고 날짜·시각만 비운다. 안이면 고정을 지킨다" {
        val visits = PeriodMustVisits()
        val svc = TripService(FakeRepo(), FakeDomestic(), FakeRegions(), NoTripEvents, clock, FakePlan(withItinerary), visits)
        val t = svc.create(acc, cmd(start = "2026-08-01", end = "2026-08-04"))
        val outside = visits.save(MustVisit.add(t.tripId, UUID.randomUUID(), UUID.randomUUID(), MustVisitType.FIXED, LocalDate.parse("2026-08-01"), LocalTime.of(10, 0), 60, clock.instant()))
        val inside = visits.save(MustVisit.add(t.tripId, UUID.randomUUID(), UUID.randomUUID(), MustVisitType.FIXED, LocalDate.parse("2026-08-03"), LocalTime.of(10, 0), null, clock.instant()))

        svc.edit(acc, t.tripId, edit("2026-08-02", "2026-08-03", dests = listOf(TripDestination(0, "제주", 1))).copy(discardItinerary = true))

        visits.store.getValue(outside.mustVisitId).let {
            it.type shouldBe MustVisitType.ANYTIME
            it.fixedDate shouldBe null
            it.fixedStart shouldBe null
            it.dwellMin shouldBe 60
        }
        visits.store.getValue(inside.mustVisitId).fixedDate shouldBe LocalDate.parse("2026-08-03")
    }

    "버리기 — 시작 뒤면 일정이 있든 없든 409" {
        listOf(withItinerary, TripPlanState(false, false, false)).forEach { state ->
            val plan = FakePlan(state)
            val svc = TripService(FakeRepo(), FakeDomestic(), FakeRegions(), NoTripEvents, clock, plan, PeriodMustVisits())
            val t = svc.create(acc, cmd(start = "2026-07-26", end = "2026-07-29"))

            shouldThrow<ConflictDetected> {
                svc.edit(acc, t.tripId, edit("2026-08-01", "2026-08-07").copy(discardItinerary = true))
            }.errorCode shouldBe ErrorCode.TRIP_PERIOD_STARTED
            plan.discarded shouldBe emptyList()
        }
    }

    "버리기 — 방문 기록이 있거나 생성 중이면 409" {
        val visited = FakePlan(withItinerary.copy(hasVisits = true))
        val svc = TripService(FakeRepo(), FakeDomestic(), FakeRegions(), NoTripEvents, clock, visited, PeriodMustVisits())
        val t = svc.create(acc, cmd(start = "2026-08-01", end = "2026-08-04"))
        shouldThrow<ConflictDetected> { svc.edit(acc, t.tripId, edit("2026-08-02", "2026-08-09").copy(discardItinerary = true)) }.errorCode shouldBe ErrorCode.TRIP_PERIOD_STARTED

        val generating = FakePlan(withItinerary.copy(generating = true))
        val svc2 = TripService(FakeRepo(), FakeDomestic(), FakeRegions(), NoTripEvents, clock, generating, PeriodMustVisits())
        val t2 = svc2.create(acc, cmd(start = "2026-08-01", end = "2026-08-04"))
        shouldThrow<ConflictDetected> { svc2.edit(acc, t2.tripId, edit("2026-08-02", "2026-08-09").copy(discardItinerary = true)) }.errorCode shouldBe ErrorCode.TRIP_PERIOD_GENERATING
    }

    "버리기 — 기간이 그대로면 아무것도 버리지 않는다" {
        val plan = FakePlan(withItinerary)
        val svc = TripService(FakeRepo(), FakeDomestic(), FakeRegions(), NoTripEvents, clock, plan, PeriodMustVisits())
        val t = svc.create(acc, cmd(start = "2026-08-01", end = "2026-08-04"))

        svc.edit(acc, t.tripId, edit("2026-08-01", "2026-08-04").copy(discardItinerary = true))

        plan.discarded shouldBe emptyList()
    }

    "PBT: 시작 전 어떤 기간으로 버려도 — 일정 없음 · 기간 = 요청값 · 고정 꼭 갈 곳은 새 기간 안에 있거나 날짜가 비었다" {
        checkAll(Arb.int(1..300), Arb.int(0..40), Arb.int(0..10)) { startOffset, nights, fixedOffset ->
            val plan = FakePlan(withItinerary)
            val visits = PeriodMustVisits()
            val svc = TripService(FakeRepo(), FakeDomestic(), FakeRegions(), NoTripEvents, clock, plan, visits)
            val t = svc.create(acc, cmd(start = "2026-08-01", end = "2026-08-11"))
            visits.save(MustVisit.add(t.tripId, UUID.randomUUID(), UUID.randomUUID(), MustVisitType.FIXED, t.startDate.plusDays(fixedOffset.toLong()), LocalTime.of(10, 0), null, clock.instant()))
            val start = LocalDate.parse("2026-07-26").plusDays(startOffset.toLong())
            val end = start.plusDays(nights.toLong())
            val dests = listOf(TripDestination(0, "제주", 0))

            val saved = svc.edit(acc, t.tripId, EditTripCommand("내 여행", start, end, 2, null, null, dests, discardItinerary = true))

            if (start != t.startDate || end != t.endDate) plan.state.hasItinerary shouldBe false
            saved.startDate shouldBe start
            saved.endDate shouldBe end
            visits.store.values.single().let { (it.fixedDate == null || it.fixedDate!! in start..end) shouldBe true }
        }
    }

    "커버 키는 편집으로 정해지고 null 이면 지워진다(가변 필드 대체)" {
        val svc = TripService(FakeRepo(), FakeDomestic(), FakeRegions(), NoTripEvents, clock, FakePlan(), PeriodMustVisits())
        val t = svc.create(acc, cmd(start = "2026-08-01", end = "2026-08-04"))

        svc.edit(acc, t.tripId, edit("2026-08-01", "2026-08-04").copy(coverKey = "11110")).coverKey shouldBe "11110"
        svc.get(acc, t.tripId).coverKey shouldBe "11110"
        svc.edit(acc, t.tripId, edit("2026-08-01", "2026-08-04")).coverKey shouldBe null
    }

    "기간이 바뀐 편집은 TripPeriodChanged 를 한 번 낸다 — 새 기간을 싣는다" {
        val events = RecordingTripEvents()
        val svc = TripService(FakeRepo(), FakeDomestic(), FakeRegions(), events, clock, FakePlan(), PeriodMustVisits())
        val t = svc.create(acc, cmd(start = "2026-08-01", end = "2026-08-04"))

        svc.edit(acc, t.tripId, edit("2026-08-02", "2026-08-05"))

        events.published shouldBe listOf(TripPeriodChanged(t.tripId.toString(), t.tripId.toString(), "2026-08-02", "2026-08-05"))
    }

    "시작일만 또는 종료일만 바뀌어도 낸다" {
        val events = RecordingTripEvents()
        val svc = TripService(FakeRepo(), FakeDomestic(), FakeRegions(), events, clock, FakePlan(), PeriodMustVisits())
        val t = svc.create(acc, cmd(start = "2026-08-01", end = "2026-08-04"))

        svc.edit(acc, t.tripId, edit("2026-08-01", "2026-08-05"))
        svc.edit(acc, t.tripId, edit("2026-08-02", "2026-08-05"))

        events.published.size shouldBe 2
    }

    "기간이 그대로인 편집은 아무것도 내지 않는다 — 제목·인원·목적지만 바꿔도" {
        val events = RecordingTripEvents()
        val svc = TripService(FakeRepo(), FakeDomestic(), FakeRegions(), events, clock, FakePlan(), PeriodMustVisits())
        val t = svc.create(acc, cmd(start = "2026-08-01", end = "2026-08-04"))

        svc.edit(acc, t.tripId, edit("2026-08-01", "2026-08-04", title = "바뀐 제목", party = 4, dests = listOf(TripDestination(0, "부산", 2))))

        events.published shouldBe emptyList()
    }

    "검증에 걸려 저장되지 않은 편집은 사건도 내지 않는다" {
        val events = RecordingTripEvents()
        val svc = TripService(FakeRepo(), FakeDomestic(), FakeRegions(), events, clock, FakePlan(), PeriodMustVisits())
        val t = svc.create(acc, cmd(start = "2026-08-01", end = "2026-08-04"))

        // 1박인데 목적지 3박 — Σnights > 박수
        shouldThrow<ValidationFailed> { svc.edit(acc, t.tripId, edit("2026-08-01", "2026-08-02")) }

        events.published shouldBe emptyList()
        svc.get(acc, t.tripId).endDate shouldBe LocalDate.parse("2026-08-04")
    }

    // 저장과 아웃박스 적재가 한 트랜잭션이어야 롤백된 편집·삭제의 사건이 안 나간다 — 어노테이션이 빠져도 기능 테스트는 초록이라 직접 고정한다.
    "edit 와 delete 는 @Transactional 이다 — 저장과 사건 발행이 한 트랜잭션" {
        listOf("edit", "delete").forEach { name ->
            TripService::class.java.declaredMethods.single { it.name == name }
                .isAnnotationPresent(org.springframework.transaction.annotation.Transactional::class.java) shouldBe true
        }
    }

    // ── 행정구역 표준코드 채우기(TRIP-361) ─────────────────────────────────────
    "확정되는 지역명은 표준코드가 채워진다" {
        val svc = TripService(FakeRepo(), FakeDomestic(), FakeRegions(), NoTripEvents, clock, FakePlan(), PeriodMustVisits())

        val t = svc.create(acc, cmd(dests = listOf(TripDestination(0, "제주", 3))))

        t.destinations.single().regionCode shouldBe "50"
    }

    "별칭으로 들어와도 같은 코드로 모인다 — 표기 흔들림이 저장에 남지 않는다" {
        val svc = TripService(FakeRepo(), FakeDomestic(), FakeRegions(), NoTripEvents, clock, FakePlan(), PeriodMustVisits())

        // 사용자가 '제주도'라고 골라도 저장되는 코드는 '제주'와 같아야 한다.
        val t = svc.create(acc, cmd(dests = listOf(TripDestination(0, "제주도", 3))))

        t.destinations.single().regionCode shouldBe "50"
        t.destinations.single().region shouldBe "제주도"   // 표시는 사용자가 고른 그대로다
    }

    /**
     * 이 테스트가 이 칸의 핵심이다. 중구는 다섯 곳이라 이름만으로는 정할 수 없다 —
     * 하나를 집으면 부산 중구를 고른 사용자에게 서울 중구가 조용히 박힌다.
     */
    "동명이지역은 코드를 비운다 — 임의로 하나 집지 않는다" {
        val svc = TripService(FakeRepo(), FakeDomestic(), FakeRegions(), NoTripEvents, clock, FakePlan(), PeriodMustVisits())

        val t = svc.create(acc, cmd(dests = listOf(TripDestination(0, "중구", 3))))

        t.destinations.single().regionCode shouldBe null
    }

    /**
     * 계약 전환(TRIP-859) — **코드를 주면 이름의 애매함이 애초에 생기지 않는다.** 바로 위 테스트에서
     * 비워지던 "중구"가, 코드를 명시하면 그 코드로 확정된다. 사용자가 화면(`GET /regions`)에서 고른
     * 결과를 그대로 싣는 경로다.
     */
    "코드를 주면 이름이 애매해도 그 코드로 확정된다" {
        val svc = TripService(FakeRepo(), FakeDomestic(), FakeRegions(), NoTripEvents, clock, FakePlan(), PeriodMustVisits())

        val t = svc.create(acc, cmd(dests = listOf(TripDestination(0, "중구", 3, regionCode = "26170"))))

        t.destinations.single().regionCode shouldBe "26170"
    }

    /**
     * 명시한 값을 **조용히 무시하지 않는다.** 무시하면 사용자가 고른 곳과 다른(또는 없는) 지역으로
     * 여행이 만들어지고 그 사실이 아무 데도 드러나지 않는다 — 이름 경로가 비워 두는 것과는 다르다.
     * 그쪽은 "정하지 못했다"이고 이쪽은 "틀린 것을 받았다"이다.
     */
    "없는 코드를 주면 거절한다 — 조용히 이름으로 되돌아가지 않는다" {
        val svc = TripService(FakeRepo(), FakeDomestic(), FakeRegions(), NoTripEvents, clock, FakePlan(), PeriodMustVisits())

        shouldThrow<ValidationFailed> {
            svc.create(acc, cmd(dests = listOf(TripDestination(0, "중구", 3, regionCode = "99999"))))
        }
    }

    /** 기존 클라이언트는 코드를 안 보낸다 — 그 경로의 동작이 한 치도 바뀌지 않아야 한다. */
    "코드를 생략하면 종전대로 이름으로 찾는다" {
        val svc = TripService(FakeRepo(), FakeDomestic(), FakeRegions(), NoTripEvents, clock, FakePlan(), PeriodMustVisits())

        val t = svc.create(acc, cmd(dests = listOf(TripDestination(0, "제주", 3))))

        t.destinations.single().regionCode shouldBe "50"
    }

    "편집해도 코드가 사라지지 않는다 — 생성만 채우면 편집이 지운다" {
        val svc = TripService(FakeRepo(), FakeDomestic(), FakeRegions(), NoTripEvents, clock, FakePlan(), PeriodMustVisits())
        val t = svc.create(acc, cmd(dests = listOf(TripDestination(0, "제주", 3))))

        // 클라이언트는 코드를 보내지 않는다(계약 불변) — 편집 입력의 regionCode 는 항상 null 이다.
        val edited = svc.edit(
            acc, t.tripId,
            EditTripCommand(
                "내 여행", LocalDate.parse("2026-08-01"), LocalDate.parse("2026-08-03"), 4, null, null,
                listOf(TripDestination(0, "부산", 2)),
            ),
        )

        edited.destinations.single().regionCode shouldBe "26"
    }

    "소프트삭제 후 조회 404 · 목록 제외" {
        val svc = TripService(FakeRepo(), FakeDomestic(), FakeRegions(), NoTripEvents, clock, FakePlan(), PeriodMustVisits())
        val t = svc.create(acc, cmd())
        svc.delete(acc, t.tripId)
        shouldThrow<ResourceNotFound> { svc.get(acc, t.tripId) }
        svc.list(acc).size shouldBe 0
    }
})

/** 목적지 판정 대역 — 카탈로그에 있는 것만 받는다. [down] 이면 확인 불가. */
private class FakeDomestic(private val down: Boolean = false) : DestinationFacade {
    override fun check(region: String): DestinationCheck = when {
        down -> DestinationCheck.UNVERIFIED
        // '제주도'는 별칭, '중구'는 카탈로그에 다섯 곳 — 실 카탈로그에서 둘 다 SUPPORTED 다.
        region in setOf("제주", "제주도", "부산", "천안", "속초시", "사하구", "중구") -> DestinationCheck.SUPPORTED
        else -> DestinationCheck.OUTSIDE
    }
}

/**
 * 지역 코드 조회 대역 — **동명이지역을 실제로 재현한다**. '사하구' 는 하나지만 '중구' 는 여럿이라
 * 코드가 확정되지 않는다. 하나만 돌려주는 대역을 쓰면 `singleOrNull` 가드가 아무것도 안 지킨다.
 */
private class FakeRegions : RegionLookupFacade {
    /** 선택 가능한 코드 — 카탈로그의 시군구·시도만. `99999` 는 없는 코드로 쓴다. */
    override fun isSelectableCode(regionCode: String): Boolean =
        regionCode in setOf("50", "26", "26380", "11140", "26170", "27110")

    override fun codesOf(regionName: String): List<String> = when (regionName) {
        "제주" -> listOf("50")
        "제주도" -> listOf("50")   // 별칭도 같은 코드로 모인다
        "부산" -> listOf("26")
        "사하구" -> listOf("26380")
        "중구" -> listOf("11140", "26170", "27110")  // 동명이지역
        else -> emptyList()
    }

    override fun centerOf(regionName: String): RegionCenter? = null
        /** 코드 중심 — 이 테스트는 이름 경로만 쓴다. */
        override fun centerOfCode(regionCode: String) = null
}
