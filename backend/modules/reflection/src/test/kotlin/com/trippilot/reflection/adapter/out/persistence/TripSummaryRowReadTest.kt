package com.trippilot.reflection.adapter.out.persistence

import com.trippilot.reflection.domain.DayHighlight
import com.trippilot.reflection.domain.DistanceSource
import com.trippilot.reflection.domain.ReflectionSource
import com.trippilot.reflection.domain.TripSummary
import com.trippilot.reflection.domain.TripSummaryStats
import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.shouldBe
import io.mockk.every
import io.mockk.mockk
import io.mockk.slot
import java.time.Instant
import java.time.LocalDate
import java.util.Optional
import java.util.UUID

/**
 * trip_summary 행 → 도메인. 읽기는 방어적이다 — 옛 행이 필드를 덜 가질 수 있다.
 *
 * 특히 **U10 이전 행의 그날 거리는 null(모름)이어야 한다.** 0 으로 채우면 화면이 "0km 이동"이라는 거짓말을 한다.
 */
class TripSummaryRowReadTest : StringSpec({

    val trip = UUID.randomUUID()
    val t0 = Instant.parse("2026-08-03T00:00:00Z")
    val fullStats = mapOf<String, Any?>(
        "totalVisits" to 5, "totalDistanceKm" to 12.5, "distanceSource" to "ROUTE", "totalPhotos" to 7, "hasLocationData" to true,
    )

    fun entity(highlights: List<Map<String, Any?>>, stats: Map<String, Any?> = fullStats) =
        TripSummaryEntity(trip, "요약", highlights, stats, "RULE", t0)

    fun read(e: TripSummaryEntity): TripSummary {
        val jpa = mockk<TripSummaryJpaRepository>()
        every { jpa.findById(trip) } returns Optional.of(e)
        return TripSummaryRepositoryAdapter(jpa).find(trip)!!
    }

    "날짜가 없거나 깨진 날은 버리고 나머지 날은 남긴다" {
        val h = read(
            entity(
                listOf(
                    mapOf("dayOrder" to 1),
                    mapOf("date" to 20260801),
                    mapOf("date" to "2026-02-30"),
                    mapOf("date" to "2026-08-02", "dayOrder" to 2, "visitCount" to 3, "places" to listOf("a", "b"), "distanceKm" to 1.5, "distanceSource" to "ROUTE"),
                ),
            ),
        ).highlights
        h shouldBe listOf(DayHighlight(LocalDate.parse("2026-08-02"), 2, 3, listOf("a", "b"), 1.5, DistanceSource.ROUTE))
    }

    "U10 이전 행처럼 거리·출처가 없거나 모르는 값이면 null(모름) — 0km 로 채우지 않는다" {
        val h = read(
            entity(
                listOf(
                    mapOf("date" to "2026-08-01"),
                    mapOf("date" to "2026-08-02", "distanceKm" to "far", "distanceSource" to "TELEPORT", "dayOrder" to "1", "visitCount" to null, "places" to "a"),
                ),
            ),
        ).highlights
        h.forEach {
            it.distanceKm shouldBe null
            it.distanceSource shouldBe null
            it.dayOrder shouldBe 0
            it.visitCount shouldBe 0
            it.places shouldBe emptyList()
        }
    }

    "여행 수치가 비었거나 타입이 틀리면 0·VISIT_LINE·위치 없음으로 읽는다 — 예외 없음" {
        val zero = TripSummaryStats(0, 0.0, DistanceSource.VISIT_LINE, 0, hasLocationData = false)
        read(entity(emptyList(), stats = emptyMap())).stats shouldBe zero
        read(
            entity(
                emptyList(),
                stats = mapOf("totalVisits" to "5", "totalDistanceKm" to null, "distanceSource" to "TELEPORT", "totalPhotos" to false, "hasLocationData" to "yes"),
            ),
        ).stats shouldBe zero
    }

    "정상 수치는 그대로 읽힌다" {
        read(entity(emptyList())).stats shouldBe TripSummaryStats(5, 12.5, DistanceSource.ROUTE, 7, hasLocationData = true)
    }

    "저장한 요약은 그대로 다시 읽힌다 — 출처 없는 날의 거리는 null 로 남는다" {
        val jpa = mockk<TripSummaryJpaRepository>()
        val saved = slot<TripSummaryEntity>()
        every { jpa.findById(trip) } returns Optional.empty()
        every { jpa.save(capture(saved)) } answers { saved.captured }
        val summary = TripSummary(
            trip, "요약",
            listOf(
                DayHighlight(LocalDate.parse("2026-08-01"), 1, 2, listOf("성산"), 3.0, DistanceSource.VISIT_LINE),
                DayHighlight(LocalDate.parse("2026-08-02"), 2, 0, emptyList()),
            ),
            TripSummaryStats(2, 3.0, DistanceSource.VISIT_LINE, 1, hasLocationData = true), ReflectionSource.AI, t0,
        )

        TripSummaryRepositoryAdapter(jpa).upsert(summary) shouldBe summary
    }

    "기존 요약이 있으면 그 행을 덮어쓴다 — 여행당 하나" {
        val existing = entity(emptyList())
        val jpa = mockk<TripSummaryJpaRepository>()
        val saved = slot<TripSummaryEntity>()
        every { jpa.findById(trip) } returns Optional.of(existing)
        every { jpa.save(capture(saved)) } answers { saved.captured }
        val again = TripSummary(trip, "다시 쓴 요약", emptyList(), TripSummaryStats(0, 0.0, DistanceSource.VISIT_LINE, 0, false), ReflectionSource.BASIC, t0.plusSeconds(60))

        TripSummaryRepositoryAdapter(jpa).upsert(again) shouldBe again
        saved.captured shouldBe existing
        existing.narrative shouldBe "다시 쓴 요약"
    }

    "없는 여행의 요약은 null 이다" {
        val jpa = mockk<TripSummaryJpaRepository>()
        every { jpa.findById(trip) } returns Optional.empty()
        TripSummaryRepositoryAdapter(jpa).find(trip) shouldBe null
    }
})
