package com.trippilot.savedaccommodation.application

import com.trippilot.core.error.ResourceNotFound
import com.trippilot.core.error.ValidationFailed
import com.trippilot.savedaccommodation.domain.BaseAssignment
import com.trippilot.savedaccommodation.domain.BaseAssignmentRepository
import com.trippilot.savedaccommodation.domain.CoverageStatus
import com.trippilot.savedaccommodation.domain.RegisterRoute
import com.trippilot.savedaccommodation.domain.SavedStay
import com.trippilot.savedaccommodation.domain.SavedStayRepository
import com.trippilot.trip.api.TripFacade
import com.trippilot.trip.api.TripPeriod
import io.kotest.assertions.throwables.shouldThrow
import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.shouldBe
import java.time.Clock
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneOffset
import java.util.UUID

private class FakeBases : BaseAssignmentRepository {
    val store = mutableMapOf<UUID, BaseAssignment>()
    override fun save(base: BaseAssignment) = base.also { store[it.baseAssignmentId] = it }
    override fun findByTrip(tripId: UUID) = store.values.filter { it.tripId == tripId }
    override fun findById(baseAssignmentId: UUID) = store[baseAssignmentId]
    override fun delete(base: BaseAssignment) { store.remove(base.baseAssignmentId) }
    override fun existsByStayId(savedStayId: UUID) = store.values.any { it.savedStayId == savedStayId }
}

private class FakeStays : SavedStayRepository {
    val store = mutableMapOf<UUID, SavedStay>()
    override fun save(stay: SavedStay) = stay.also { store[it.savedStayId] = it }
    override fun findById(savedStayId: UUID) = store[savedStayId]
    override fun findByAccount(accountId: UUID) = store.values.filter { it.accountId == accountId }
    override fun delete(stay: SavedStay) { store.remove(stay.savedStayId) }
}

/** (acc,tripId) → period 를 등록해두면 소유로 간주. 미등록은 null(404). */
private class FakeTrips : TripFacade {
    val periods = mutableMapOf<Pair<UUID, UUID>, TripPeriod>()
    override fun findPeriod(accountId: UUID, tripId: UUID) = periods[accountId to tripId]
}

class BaseAssignmentServiceTest : StringSpec({

    val clock = Clock.fixed(Instant.parse("2026-07-26T00:00:00Z"), ZoneOffset.UTC)
    val acc = UUID.randomUUID()
    val other = UUID.randomUUID()
    val start = LocalDate.parse("2026-08-01")
    val end = LocalDate.parse("2026-08-04")

    fun fixture(): Triple<BaseAssignmentService, FakeStays, Pair<UUID, UUID>> {
        val stays = FakeStays()
        val trips = FakeTrips()
        val tripId = UUID.randomUUID()
        trips.periods[acc to tripId] = TripPeriod(start, end)
        val svc = BaseAssignmentService(FakeBases(), stays, trips, clock)
        return Triple(svc, stays, acc to tripId)
    }

    fun stay(stays: FakeStays, owner: UUID): UUID =
        stays.save(
            SavedStay.register(owner, "숙소", 37.5, 127.0, true, null, null, null, null, RegisterRoute.PIN, null, clock.instant()),
        ).savedStayId

    fun cmd(stayId: UUID, from: String = "2026-08-01", to: String = "2026-08-04") =
        AssignBaseCommand(stayId, LocalDate.parse(from), LocalDate.parse(to))

    "거점 배정 후 목록 조회" {
        val (svc, stays, t) = fixture()
        val s = stay(stays, acc)
        svc.assign(acc, t.second, cmd(s))
        svc.list(acc, t.second).single().savedStayId shouldBe s
    }

    "타 계정 여행이면 404" {
        val (svc, stays, t) = fixture()
        val s = stay(stays, acc)
        shouldThrow<ResourceNotFound> { svc.assign(other, t.second, cmd(s)) }
    }

    "타 계정 숙소로 거점 배정은 404" {
        val (svc, stays, t) = fixture()
        val s = stay(stays, other)
        shouldThrow<ResourceNotFound> { svc.assign(acc, t.second, cmd(s)) }
    }

    "좌표 미확정 숙소는 거점 배정 불가 400(INV-U1-08)" {
        val (svc, stays, t) = fixture()
        val unconfirmed = stays.save(
            SavedStay.register(acc, "미확정", null, null, false, null, null, null, null, RegisterRoute.LINK_PASTE, null, clock.instant()),
        ).savedStayId
        shouldThrow<ValidationFailed> { svc.assign(acc, t.second, cmd(unconfirmed)) }
    }

    "여행 기간 밖 구간은 400(INV-U1-15)" {
        val (svc, stays, t) = fixture()
        val s = stay(stays, acc)
        shouldThrow<ValidationFailed> { svc.assign(acc, t.second, cmd(s, "2026-08-01", "2026-08-05")) }
    }

    "이어붙은 구간 거점이면 커버리지 비차단" {
        val (svc, stays, t) = fixture()
        val s1 = stay(stays, acc)
        val s2 = stay(stays, acc)
        svc.assign(acc, t.second, cmd(s1, "2026-08-01", "2026-08-03"))
        svc.assign(acc, t.second, cmd(s2, "2026-08-03", "2026-08-04"))
        val cov = svc.coverage(acc, t.second)
        cov.blocked shouldBe false
        cov.days.map { it.status }.toSet() shouldBe setOf(CoverageStatus.AUTO)
    }

    "공백일이 있으면 커버리지 차단" {
        val (svc, stays, t) = fixture()
        val s = stay(stays, acc)
        svc.assign(acc, t.second, cmd(s, "2026-08-01", "2026-08-03")) // 8/3 공백
        svc.coverage(acc, t.second).blocked shouldBe true
    }

    "거점 삭제 후 목록 제외" {
        val (svc, stays, t) = fixture()
        val s = stay(stays, acc)
        val base = svc.assign(acc, t.second, cmd(s))
        svc.remove(acc, t.second, base.baseAssignmentId)
        svc.list(acc, t.second).size shouldBe 0
    }

    "다른 여행의 거점 id 삭제는 404" {
        val (svc, stays, t) = fixture()
        val s = stay(stays, acc)
        svc.assign(acc, t.second, cmd(s))
        shouldThrow<ResourceNotFound> { svc.remove(acc, t.second, UUID.randomUUID()) }
    }
})
