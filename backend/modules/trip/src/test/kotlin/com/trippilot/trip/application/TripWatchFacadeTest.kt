package com.trippilot.trip.application

import com.trippilot.trip.api.TripWatchFacade
import com.trippilot.trip.api.WatchedTrip
import com.trippilot.trip.domain.MustVisit
import com.trippilot.trip.domain.MustVisitRepository
import com.trippilot.trip.domain.Trip
import com.trippilot.trip.domain.TripRepository
import com.trippilot.trip.domain.TripWatchRepository
import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.shouldBe
import io.kotest.property.Arb
import io.kotest.property.arbitrary.int
import io.kotest.property.checkAll
import java.time.LocalDate
import java.util.UUID

/**
 * 감시 대상 여행 조회(Plan-B 상황 스윕용) — 퍼사드가 하는 일은 **페이지 크기를 묶는 것**뿐이다.
 * 술어(겹침·삭제·종료 기록)와 키셋은 실 DB 가 판정하므로 `TripWatchQueryIT` 가 본다.
 */
class TripWatchFacadeTest : StringSpec({

    /** 받은 인자를 적어 두고 정해 둔 행을 낸다. */
    class RecordingWatch(private val rows: List<WatchedTrip>) : TripWatchRepository {
        val calls = mutableListOf<List<Any?>>()
        override fun findOverlapping(from: LocalDate, to: LocalDate, after: UUID?, limit: Int): List<WatchedTrip> {
            calls += listOf(from, to, after, limit)
            return rows
        }
    }

    // 퍼사드 구현 빈은 이 둘도 받는다 — 감시 조회는 쓰지 않으므로 부르면 실패한다(조용히 빈 값을 내지 않는다).
    val noTrips = object : TripRepository {
        override fun save(trip: Trip) = error("감시 조회는 여행 저장소를 쓰지 않습니다.")
        override fun findById(tripId: UUID) = error("감시 조회는 여행 저장소를 쓰지 않습니다.")
        override fun findByAccount(accountId: UUID) = error("감시 조회는 여행 저장소를 쓰지 않습니다.")
    }
    val noMustVisits = object : MustVisitRepository {
        override fun save(mustVisit: MustVisit) = error("쓰지 않습니다.")
        override fun findByTrip(tripId: UUID) = error("쓰지 않습니다.")
        override fun findById(mustVisitId: UUID) = error("쓰지 않습니다.")
        override fun existsByTripAndSourcePoi(tripId: UUID, sourcePoiId: UUID) = error("쓰지 않습니다.")
        override fun delete(mustVisit: MustVisit) = error("쓰지 않습니다.")
    }

    val day = LocalDate.parse("2026-08-11")

    "구간·키셋 인자를 그대로 묻고 저장소의 행을 그대로 낸다 — 사용자 맥락이 없는 조회다" {
        val row = WatchedTrip(UUID.randomUUID(), UUID.randomUUID(), day.minusDays(1), day.plusDays(1))
        val watch = RecordingWatch(listOf(row))
        val after = UUID.randomUUID()
        val facade: TripWatchFacade = TripPeriodFacade(noTrips, noMustVisits, watch)

        facade.findOverlapping(day, day.plusDays(1), after, 50) shouldBe listOf(row)
        watch.calls.single() shouldBe listOf(day, day.plusDays(1), after, 50)
    }

    "페이지 크기는 1..500 으로 묶는다 — 0 이하가 빈 페이지(= 끝)로, 과대 요청이 전량 조회로 새지 않게" {
        checkAll(Arb.int()) { limit ->
            val watch = RecordingWatch(emptyList())
            TripPeriodFacade(noTrips, noMustVisits, watch).findOverlapping(day, day, null, limit)
            watch.calls.single()[3] shouldBe limit.coerceIn(1, 500)
        }
    }
})
