package com.trippilot.trip.application

import com.trippilot.trip.api.TripPreferenceSnapshot
import com.trippilot.trip.domain.MustVisit
import com.trippilot.trip.domain.MustVisitRepository
import com.trippilot.trip.domain.Trip
import com.trippilot.trip.domain.TripDestination
import com.trippilot.trip.domain.TripRepository
import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.shouldBe
import java.time.Instant
import java.time.LocalDate
import java.util.UUID

private class OneTripRepo(private val trip: Trip) : TripRepository {
    override fun save(trip: Trip) = trip
    override fun findById(tripId: UUID) = trip.takeIf { it.tripId == tripId }
    override fun findByAccount(accountId: UUID) = listOf(trip).filter { it.accountId == accountId }
}

/** 필수 방문지는 이 스펙의 관심사가 아니다 — 쓰이면 드러나도록 나머지는 막는다. */
private object NoMustVisits : MustVisitRepository {
    override fun save(mustVisit: MustVisit): MustVisit = error("이 테스트는 필수 방문지를 쓰지 않는다")
    override fun findByTrip(tripId: UUID): List<MustVisit> = emptyList()
    override fun findById(mustVisitId: UUID): MustVisit? = error("이 테스트는 필수 방문지를 쓰지 않는다")
    override fun existsByTripAndSourcePoi(tripId: UUID, sourcePoiId: UUID): Boolean =
        error("이 테스트는 필수 방문지를 쓰지 않는다")
    override fun delete(mustVisit: MustVisit) = error("이 테스트는 필수 방문지를 쓰지 않는다")
}

/**
 * 저장된 여행 취향이 **생성 컨텍스트까지 실려 나가는지** — 배선 한 칸을 지킨다.
 *
 * 병합 규칙만 테스트하면 이 칸이 비는 것을 못 잡는다: 소비처(일정 생성)는 가짜 파사드를 쓰므로
 * 여기서 안 실어도 전부 초록이다. 실제로 그 상태로 출하돼 사용자가 고른 취향이 통째로 버려졌다
 * (2026-10-05, AI 쪽에서 먼저 발견). 역검증으로 확인한 자리다.
 */
class TripGenerationContextPreferenceTest : StringSpec({

    val acc = UUID.randomUUID()
    val start = LocalDate.parse("2026-08-01")

    fun contextOf(snapshot: Map<String, Any?>): TripPreferenceSnapshot {
        val trip = Trip.create(
            acc, "제주 여행", start, start.plusDays(2), 2, null, null,
            snapshot, listOf(TripDestination(0, "제주", 2)), Instant.parse("2026-07-26T00:00:00Z"),
        )
        val facade = TripPeriodFacade(OneTripRepo(trip), NoMustVisits)
        return facade.findGenerationContext(acc, trip.tripId)!!.preferences
    }

    "여행 생성 때 고른 취향이 생성 컨텍스트에 실린다" {
        contextOf(mapOf("styles" to listOf("액티비티"), "activities" to listOf("등산"))) shouldBe
            TripPreferenceSnapshot(styles = listOf("액티비티"), activities = listOf("등산"))
    }

    "취향을 고르지 않은 여행은 빈 스냅숏 — 소비처가 계정 취향으로 보충한다" {
        contextOf(emptyMap()) shouldBe TripPreferenceSnapshot.EMPTY
    }
})
