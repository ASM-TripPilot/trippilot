package com.trippilot.archive.application

import com.trippilot.archive.domain.CheckSource
import com.trippilot.archive.domain.VisitCheck
import com.trippilot.archive.domain.VisitCheckRepository
import com.trippilot.archive.domain.VisitPhotoMeta
import com.trippilot.archive.domain.VisitPhotoMetaRepository
import com.trippilot.trip.api.TripListFacade
import com.trippilot.trip.api.TripSummaryView
import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.collections.shouldContainExactly
import io.kotest.matchers.shouldBe
import java.time.Instant
import java.time.LocalDate
import java.util.UUID

/**
 * 지난 여행 기록 목록(BR-U5-56 · `j07`).
 *
 * 가장 중요한 축은 **빈 상태를 값으로 알리는 것**이다. 빈 배열만 주면 화면이 "오류인가, 상한에
 * 걸렸나, 정말 없나"를 구분하지 못하는데 그 셋은 보여 줄 것이 전부 다르다.
 */
class TripRecordListServiceTest : StringSpec({

    val acc = UUID.randomUUID()
    val now = Instant.parse("2026-08-11T03:00:00Z")

    class Checks : VisitCheckRepository {
        val stored = mutableListOf<VisitCheck>()
        override fun save(check: VisitCheck) = check.also { stored += it }
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

    class Trips(private val all: List<TripSummaryView>) : TripListFacade {
        var askedLimit: Int? = null
        override fun findTripsOf(accountId: UUID, limit: Int): List<TripSummaryView> {
            askedLimit = limit
            return if (accountId == acc) all.sortedByDescending { it.startDate }.take(limit) else emptyList()
        }
        override fun hasAnyTrip(accountId: UUID) = accountId == acc && all.isNotEmpty()
    }

    fun trip(start: String, title: String) = TripSummaryView(
        UUID.randomUUID(), title, LocalDate.parse(start), LocalDate.parse(start).plusDays(2), listOf("제주"),
    )

    // ── 빈 상태 ────────────────────────────────────────────────────────
    "여행이 0건이면 NO_TRIPS 로 알린다 — 빈 배열만 주지 않는다" {
        val svc = TripRecordListService(Trips(emptyList()), Checks(), Photos())

        val result = svc.list(acc)

        result.items shouldBe emptyList()
        result.emptyState shouldBe RecordEmptyState.NO_TRIPS
    }

    "여행은 있는데 목록이 비면 NO_RECORDS — 새 여행을 만들라고 하면 안 된다" {
        // 여행은 존재하지만 목록 조회가 비어 돌아오는 경우(예: 전부 삭제 처리된 뒤)
        val trips = object : TripListFacade {
            override fun findTripsOf(accountId: UUID, limit: Int) = emptyList<TripSummaryView>()
            override fun hasAnyTrip(accountId: UUID) = true
        }

        val result = TripRecordListService(trips, Checks(), Photos()).list(acc)

        result.emptyState shouldBe RecordEmptyState.NO_RECORDS
    }

    "목록이 있으면 emptyState 를 붙이지 않는다 — 둘 다 주면 화면이 갈피를 잃는다" {
        val svc = TripRecordListService(Trips(listOf(trip("2026-08-10", "제주 여행"))), Checks(), Photos())

        svc.list(acc).emptyState shouldBe null
    }

    // ── 목록 ───────────────────────────────────────────────────────────
    "최신순으로 온다" {
        val trips = listOf(trip("2026-07-01", "오래된"), trip("2026-08-10", "최근"), trip("2026-06-01", "더 오래된"))
        val svc = TripRecordListService(Trips(trips), Checks(), Photos())

        svc.list(acc).items.map { it.title } shouldContainExactly listOf("최근", "오래된", "더 오래된")
    }

    // 시드가 상한보다 적으면 어떤 상한값이어도 통과한다 — 상한+1 을 실제로 쌓고 경계를 잰다.
    "상한을 넘겨 요청해도 최대치까지만 조인다" {
        val many = (1..(TripRecordListService.MAX_LIMIT + 1)).map { trip("2026-08-%02d".format((it % 28) + 1), "여행 $it") }
        val trips = Trips(many)
        val svc = TripRecordListService(trips, Checks(), Photos())

        val result = svc.list(acc, limit = Int.MAX_VALUE)

        trips.askedLimit shouldBe TripRecordListService.MAX_LIMIT
        result.items.size shouldBe TripRecordListService.MAX_LIMIT
    }

    "0 이하를 넘겨도 최소 한 건은 조인다" {
        val trips = Trips(listOf(trip("2026-08-10", "제주 여행")))
        TripRecordListService(trips, Checks(), Photos()).list(acc, limit = 0)

        trips.askedLimit shouldBe 1
    }

    "한 줄에 방문 수·사진 수가 함께 온다" {
        val t = trip("2026-08-10", "제주 여행")
        val checks = Checks()
        val visits = List(3) {
            checks.save(VisitCheck.arrive(t.tripId, "2026-08-10#${UUID.randomUUID()}", UUID.randomUUID(), CheckSource.MANUAL, now))
        }
        val svc = TripRecordListService(
            Trips(listOf(t)), checks,
            Photos(mapOf(visits[0].visitCheckId to 2, visits[1].visitCheckId to 5)),
        )

        val row = svc.list(acc).items.single()

        row.visitCount shouldBe 3
        row.photoCount shouldBe 7 // 사진이 0장인 방문은 더하지 않는다
        row.regions shouldContainExactly listOf("제주")
    }

    "타 계정 여행은 나오지 않는다" {
        val svc = TripRecordListService(Trips(listOf(trip("2026-08-10", "남의 여행"))), Checks(), Photos())

        val result = svc.list(UUID.randomUUID())

        result.items shouldBe emptyList()
        // 남의 계정에는 여행이 없으므로 NO_TRIPS 다 — 존재를 알리지 않는다.
        result.emptyState shouldBe RecordEmptyState.NO_TRIPS
    }
})
