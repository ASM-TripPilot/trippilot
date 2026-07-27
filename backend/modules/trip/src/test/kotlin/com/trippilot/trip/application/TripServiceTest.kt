package com.trippilot.trip.application

import com.trippilot.core.error.ResourceNotFound
import com.trippilot.core.error.ValidationFailed
import com.trippilot.trip.domain.Trip
import com.trippilot.trip.domain.TripDestination
import com.trippilot.trip.domain.TripRepository
import io.kotest.assertions.throwables.shouldThrow
import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.shouldBe
import java.time.Clock
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneOffset
import java.util.UUID

private class FakeRepo : TripRepository {
    val store = mutableMapOf<UUID, Trip>()
    override fun save(trip: Trip) = trip.also { store[it.tripId] = it }
    override fun findById(tripId: UUID) = store[tripId]
    override fun findByAccount(accountId: UUID) = store.values.filter { it.accountId == accountId }
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
        val svc = TripService(FakeRepo(), clock)
        val t = svc.create(acc, cmd())
        t.title shouldBe "제주 여행"
        t.preferenceSnapshot["pace"] shouldBe "알차게"
        svc.get(acc, t.tripId).party shouldBe 2
        svc.list(acc).size shouldBe 1
    }

    "타 계정 리소스는 404" {
        val svc = TripService(FakeRepo(), clock)
        val t = svc.create(acc, cmd())
        shouldThrow<ResourceNotFound> { svc.get(other, t.tripId) }
    }

    "국내 밖 목적지는 400(INV-U1-12)" {
        val svc = TripService(FakeRepo(), clock)
        shouldThrow<ValidationFailed> { svc.create(acc, cmd(dests = listOf(TripDestination(0, "도쿄", 2)))) }
    }

    "종료일 < 시작일은 400(INV-U1-11)" {
        val svc = TripService(FakeRepo(), clock)
        shouldThrow<ValidationFailed> { svc.create(acc, cmd(start = "2026-08-04", end = "2026-08-01")) }
    }

    "도시 박수 합이 기간 초과면 400(INV-U1-14)" {
        val svc = TripService(FakeRepo(), clock)
        // 3박4일인데 제주 3 + 부산 2 = 5박 > 3
        shouldThrow<ValidationFailed> {
            svc.create(acc, cmd(dests = listOf(TripDestination(0, "제주", 3), TripDestination(1, "부산", 2))))
        }
    }

    "편집은 가변필드 대체" {
        val svc = TripService(FakeRepo(), clock)
        val t = svc.create(acc, cmd())
        val edited = svc.edit(acc, t.tripId, EditTripCommand("내 여행", LocalDate.parse("2026-08-01"), LocalDate.parse("2026-08-03"), 4, null, null, listOf(TripDestination(0, "부산", 2))))
        edited.title shouldBe "내 여행"
        edited.party shouldBe 4
        edited.destinations.single().region shouldBe "부산"
    }

    "소프트삭제 후 조회 404 · 목록 제외" {
        val svc = TripService(FakeRepo(), clock)
        val t = svc.create(acc, cmd())
        svc.delete(acc, t.tripId)
        shouldThrow<ResourceNotFound> { svc.get(acc, t.tripId) }
        svc.list(acc).size shouldBe 0
    }
})
