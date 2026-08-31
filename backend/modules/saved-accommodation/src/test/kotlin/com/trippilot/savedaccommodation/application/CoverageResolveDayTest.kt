package com.trippilot.savedaccommodation.application

import com.trippilot.core.error.ConflictDetected
import com.trippilot.core.error.ResourceNotFound
import com.trippilot.core.error.ValidationFailed
import com.trippilot.savedaccommodation.api.event.TripBaseResolved
import com.trippilot.savedaccommodation.domain.BaseAssignment
import com.trippilot.savedaccommodation.domain.BaseAssignmentRepository
import com.trippilot.savedaccommodation.domain.BaseResolution
import com.trippilot.savedaccommodation.domain.CoverageStatus
import com.trippilot.savedaccommodation.domain.RegisterRoute
import com.trippilot.savedaccommodation.domain.SavedStay
import com.trippilot.savedaccommodation.domain.SavedStayRepository
import com.trippilot.trip.api.TripFacade
import com.trippilot.trip.api.TripGenerationContext
import com.trippilot.trip.api.TripPeriod
import io.kotest.assertions.throwables.shouldThrow
import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.collections.shouldContainExactly
import io.kotest.matchers.shouldBe
import java.time.Clock
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneOffset
import java.util.UUID

private class PickBases : BaseAssignmentRepository {
    val store = mutableMapOf<UUID, BaseAssignment>()
    override fun save(base: BaseAssignment) = base.also { store[it.baseAssignmentId] = it }
    override fun findByTrip(tripId: UUID) = store.values.filter { it.tripId == tripId }
    override fun findById(baseAssignmentId: UUID) = store[baseAssignmentId]
    override fun delete(base: BaseAssignment) { store.remove(base.baseAssignmentId) }
    override fun existsByStayId(savedStayId: UUID) = store.values.any { it.savedStayId == savedStayId }
    override fun findTripIdsByStays(savedStayIds: Collection<UUID>) =
        store.values.filter { it.savedStayId in savedStayIds }
            .groupBy { it.savedStayId }
            .mapValues { (_, rows) -> rows.map { r -> r.tripId }.distinct() }
}

private class PickStays : SavedStayRepository {
    val store = mutableMapOf<UUID, SavedStay>()
    override fun save(stay: SavedStay) = stay.also { store[it.savedStayId] = it }
    override fun findById(savedStayId: UUID) = store[savedStayId]
    override fun findByAccount(accountId: UUID) = store.values.filter { it.accountId == accountId }
    override fun delete(stay: SavedStay) { store.remove(stay.savedStayId) }
}

private class PickTrips : TripFacade {
    val periods = mutableMapOf<Pair<UUID, UUID>, TripPeriod>()
    override fun findPeriod(accountId: UUID, tripId: UUID) = periods[accountId to tripId]
    override fun findGenerationContext(accountId: UUID, tripId: UUID): TripGenerationContext? = null
}

/**
 * 거점 커버리지 해소(TRIP-190 · US-STAY-07 · BR-U1-45).
 *
 * 커버리지는 **차단형**이라(INV-U1-16), 해소 경로가 없으면 겹치게 등록한 사용자는 배정을 지우는 것 말고
 * 빠져나올 길이 없다. 여기서 검증하는 것은 "고를 수 있는가"가 아니라 **고른 결과가 게이트를 여는가**다.
 */
class CoverageResolveDayTest : StringSpec({

    val clock = Clock.fixed(Instant.parse("2026-07-26T00:00:00Z"), ZoneOffset.UTC)
    val acc = UUID.randomUUID()
    val start = LocalDate.parse("2026-08-01")
    val end = LocalDate.parse("2026-08-04") // 숙박일 08-01·02·03 (08-04 는 체크아웃)

    class Fixture {
        val bases = PickBases()
        val stays = PickStays()
        val trips = PickTrips()
        val days = FakeTripBaseDays()
        val events = CapturingEvents()
        lateinit var service: BaseAssignmentService
        lateinit var anchors: BaseAnchorQueryFacade
        val tripId: UUID = UUID.randomUUID()
    }

    fun fixture(): Fixture = Fixture().apply {
        trips.periods[acc to tripId] = TripPeriod(start, end)
        service = BaseAssignmentService(bases, stays, trips, days, events, clock)
        anchors = BaseAnchorQueryFacade(bases, stays, days)
    }

    fun Fixture.stay(lat: Double, lng: Double): UUID = stays.save(
        SavedStay.register(acc, "숙소", lat, lng, true, null, null, null, null, RegisterRoute.PIN, null, clock.instant()),
    ).savedStayId

    fun Fixture.assign(stayId: UUID, from: String, to: String) = service.assign(
        acc, tripId, AssignBaseCommand(stayId, LocalDate.parse(from), LocalDate.parse(to)),
    )

    /** 08-01·02 를 두 숙소가 함께 덮는 겹침 여행. 08-03 은 첫 숙소만 덮어 AUTO. */
    fun overlapping(): Triple<Fixture, UUID, UUID> {
        val f = fixture()
        val a = f.stay(33.45, 126.56)
        val b = f.stay(35.15, 129.05)
        f.assign(a, "2026-08-01", "2026-08-04")
        f.assign(b, "2026-08-01", "2026-08-03")
        return Triple(f, a, b)
    }

    "겹치게 등록하면 차단되고, 그 날 후보가 응답에 실린다" {
        val (f, a, b) = overlapping()
        val cov = f.service.coverage(acc, f.tripId)

        cov.blocked shouldBe true
        val day1 = cov.days.single { it.date == start }
        day1.status shouldBe CoverageStatus.OVERLAP
        day1.resolution shouldBe null
        // 후보를 안 실으면 화면이 배정 목록을 받아 날짜 겹침을 다시 계산해야 한다.
        day1.candidates.toSet() shouldBe setOf(a, b)
    }

    "겹침일을 고르면 그 날이 확정되고 겹쳤다는 사실은 남는다" {
        val (f, _, b) = overlapping()
        val cov = f.service.resolveDay(acc, f.tripId, start, b)

        val day1 = cov.days.single { it.date == start }
        day1.savedStayId shouldBe b
        day1.resolution shouldBe BaseResolution.USER_PICK
        day1.status shouldBe CoverageStatus.OVERLAP // 배정이 겹친 사실 자체는 그대로다
    }

    // 이 테스트가 이 티켓의 핵심 — 고르는 것만 되고 게이트가 안 열리면 사용자는 여전히 갇혀 있다.
    "겹침일을 전부 고르면 차단이 풀리고 게이트 해제 이벤트가 나간다" {
        val (f, _, b) = overlapping()
        f.service.resolveDay(acc, f.tripId, start, b).blocked shouldBe true // 아직 08-02 가 남았다
        f.events.published shouldBe emptyList()

        val after = f.service.resolveDay(acc, f.tripId, start.plusDays(1), b)

        after.blocked shouldBe false
        f.events.published.map { it.eventType } shouldContainExactly listOf("stay.TripBaseResolved")
        (f.events.published.single() as TripBaseResolved).aggregateId shouldBe f.tripId.toString()
    }

    // 이미 열린 게이트를 다시 알리면 소비자가 일정 생성을 두 번 유도한다.
    "이미 풀린 뒤 다시 골라도 이벤트가 또 나가지는 않는다" {
        val (f, a, b) = overlapping()
        f.service.resolveDay(acc, f.tripId, start, b)
        f.service.resolveDay(acc, f.tripId, start.plusDays(1), b)
        f.service.resolveDay(acc, f.tripId, start, a) // 다시 고르기(덮어쓰기)

        f.events.published.size shouldBe 1
    }

    // 해소가 화면에만 반영되고 일정 생성이 못 읽으면, 사용자는 풀었는데 결과가 그대로다.
    "고른 거점이 일정 생성 앵커에 실제로 실린다" {
        val (f, _, b) = overlapping()
        f.anchors.findStayNightAnchors(f.tripId, start, end).map { it.date } shouldContainExactly
            listOf(start.plusDays(2)) // 해소 전에는 AUTO 인 08-03 만

        f.service.resolveDay(acc, f.tripId, start, b)
        f.service.resolveDay(acc, f.tripId, start.plusDays(1), b)

        val anchors = f.anchors.findStayNightAnchors(f.tripId, start, end)
        anchors.map { it.date } shouldContainExactly listOf(start, start.plusDays(1), start.plusDays(2))
        anchors.first().lat shouldBe 35.15 // 고른 숙소(b)의 좌표
    }

    "공백일은 이 여행에 배정된 숙소 중에서 고른다" {
        val f = fixture()
        val a = f.stay(33.45, 126.56)
        f.assign(a, "2026-08-01", "2026-08-02") // 08-02·03 은 공백

        val gap = f.service.coverage(acc, f.tripId).days.single { it.date == start.plusDays(1) }
        gap.status shouldBe CoverageStatus.GAP
        gap.candidates shouldBe emptyList() // 그 날을 덮는 후보는 없다

        val after = f.service.resolveDay(acc, f.tripId, start.plusDays(1), a)
        after.days.single { it.date == start.plusDays(1) }.resolution shouldBe BaseResolution.USER_PICK
    }

    "그 여행에 배정되지 않은 숙소는 고를 수 없다 — 엉뚱한 곳에서 일정이 시작된다" {
        val (f, _, _) = overlapping()
        val stranger = f.stay(37.5, 127.0) // 등록만 하고 배정하지 않은 숙소

        shouldThrow<ValidationFailed> { f.service.resolveDay(acc, f.tripId, start, stranger) }
    }

    "겹침일에 그 날 후보가 아닌 숙소는 고를 수 없다" {
        val f = fixture()
        val a = f.stay(33.45, 126.56)
        val b = f.stay(35.15, 129.05)
        val c = f.stay(37.5, 127.0)
        f.assign(a, "2026-08-01", "2026-08-03")
        f.assign(b, "2026-08-01", "2026-08-03")
        f.assign(c, "2026-08-03", "2026-08-04") // 08-03 만 덮는다

        // 08-01 은 a·b 가 겹친다 — c 는 그 날 후보가 아니다.
        shouldThrow<ValidationFailed> { f.service.resolveDay(acc, f.tripId, start, c) }
    }

    "자동 확정된 날은 고쳐 쓸 수 없다 — 배정과 확정이 다른 말을 하게 된다" {
        val (f, a, _) = overlapping()
        shouldThrow<ConflictDetected> { f.service.resolveDay(acc, f.tripId, start.plusDays(2), a) }
    }

    "체크아웃 날짜는 숙박일이 아니라 고를 수 없다" {
        val (f, _, b) = overlapping()
        shouldThrow<ValidationFailed> { f.service.resolveDay(acc, f.tripId, end, b) }
    }

    "여행 기간 밖 날짜도 마찬가지" {
        val (f, _, b) = overlapping()
        shouldThrow<ValidationFailed> { f.service.resolveDay(acc, f.tripId, start.minusDays(1), b) }
    }

    "남의 여행은 해소할 수 없다 — 404" {
        val (f, _, b) = overlapping()
        shouldThrow<ResourceNotFound> { f.service.resolveDay(UUID.randomUUID(), f.tripId, start, b) }
    }

    /**
     * 겹침이 남아 있는 채로 **고른 숙소만** 빠지는 경우. 위 테스트는 겹침이 풀려 AUTO 가 되는 경로라
     * 무효 선택 판정을 지나가지 않는다 — 그 경로가 여기서만 드러난다.
     */
    "고른 숙소의 배정만 사라지면 그 날은 다시 미해결이 된다" {
        val f = fixture()
        val a = f.stay(33.45, 126.56)
        val b = f.stay(35.15, 129.05)
        val c = f.stay(37.5, 127.0)
        listOf(a, b, c).forEach { f.assign(it, "2026-08-01", "2026-08-04") } // 전 숙박일이 3중 겹침

        f.service.resolveDay(acc, f.tripId, start, c)
        f.service.coverage(acc, f.tripId).days.single { it.date == start }.savedStayId shouldBe c

        val cAssignment = f.bases.findByTrip(f.tripId).single { it.savedStayId == c }
        f.service.remove(acc, f.tripId, cAssignment.baseAssignmentId)

        val day1 = f.service.coverage(acc, f.tripId).days.single { it.date == start }
        day1.status shouldBe CoverageStatus.OVERLAP // a·b 가 여전히 겹친다
        day1.savedStayId shouldBe null              // c 선택은 무효 — 다시 고르게 한다
        day1.resolution shouldBe null
    }

    /**
     * 배정이 바뀌어 선택이 무의미해졌는데도 확정으로 세면, 그 여행에 없는 숙소를 거점으로 일정을 짜게 된다.
     * 화면이 다시 고르게 하는 것이 맞다.
     */
    "고른 뒤 그 배정을 지우면 선택은 무효가 되어 다시 미해결이 된다" {
        val (f, a, b) = overlapping()
        f.service.resolveDay(acc, f.tripId, start, b)
        f.service.resolveDay(acc, f.tripId, start.plusDays(1), b)
        f.service.coverage(acc, f.tripId).blocked shouldBe false

        val bAssignment = f.bases.findByTrip(f.tripId).single { it.savedStayId == b }
        f.service.remove(acc, f.tripId, bAssignment.baseAssignmentId)

        val cov = f.service.coverage(acc, f.tripId)
        // b 가 사라져 08-01·02 는 a 만 덮는다 → AUTO 로 자동 확정되고, 무효해진 선택은 무시된다.
        cov.blocked shouldBe false
        cov.days.single { it.date == start }.savedStayId shouldBe a
        cov.days.single { it.date == start }.resolution shouldBe BaseResolution.AUTO
    }
})
