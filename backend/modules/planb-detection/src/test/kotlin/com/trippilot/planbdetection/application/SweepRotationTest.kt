package com.trippilot.planbdetection.application

import com.trippilot.trip.api.TripWatchFacade
import com.trippilot.trip.api.WatchedTrip
import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.shouldBe
import io.kotest.matchers.shouldNotBe
import io.kotest.property.Arb
import io.kotest.property.arbitrary.bind
import io.kotest.property.arbitrary.int
import io.kotest.property.arbitrary.list
import io.kotest.property.arbitrary.long
import io.kotest.property.checkAll
import java.time.Instant
import java.time.LocalDate
import java.util.UUID

/**
 * 회차 순서(설계서 규칙 3 · BR-SA-03 ① · 검토 K6) — 시작 위치를 회차마다 바꿔 한 바퀴 돈다(상태 저장 없음).
 * 예산으로 중단된 뒤 늘 첫 페이지부터 돌면 꼬리 여행이 영영 평가되지 않는다.
 */
class SweepRotationTest : StringSpec({

    val day = LocalDate.parse("2026-08-11")
    val acc = UUID.randomUUID()
    // 최상위 비트가 선 키까지 고르게 — v4 만 쓰면 버전 니블이 고정돼 키 공간 일부만 본다.
    val anyUuid = Arb.bind(Arb.long(), Arb.long()) { hi, lo -> UUID(hi, lo) }

    fun tripOf(id: UUID) = WatchedTrip(id, acc, day, day)

    "모든 여행을 정확히 한 번 — 피벗 다음 키부터 끝까지, 이어 처음부터 피벗까지(PBT)" {
        checkAll(Arb.list(anyUuid, 0..40), anyUuid, Arb.int(1..7)) { ids, pivot, page ->
            val distinct = ids.distinct()
            val facade = InMemoryWatchedTrips(distinct.map(::tripOf))

            val order = roundOrder(facade, day, day, pivot, page).map { it.tripId }

            val sorted = distinct.sortedWith(PG_UUID_ORDER)
            order shouldBe sorted.filter { PG_UUID_ORDER.compare(it, pivot) > 0 } + sorted.filter { PG_UUID_ORDER.compare(it, pivot) <= 0 }
        }
    }

    "읽는 사이 여행이 생기거나 지워져도 같은 여행을 두 번 넣지 않는다 — 두 바퀴째는 이미 본 키에서 멈춘다" {
        val ids = List(6) { UUID(0L, (it + 1).toLong() * 10) } // 10, 20, …, 60
        val pivot = UUID(0L, 35)
        val born = UUID(0L, 5) // 피벗 앞에 새로 생긴다
        val inner = InMemoryWatchedTrips(ids.map(::tripOf))
        // 첫 바퀴(피벗 다음)를 다 읽은 직후 — 새 여행이 생기고 첫 바퀴 맨 앞(40)이 지워진다.
        val facade = object : TripWatchFacade {
            var mutated = false
            override fun findOverlapping(from: LocalDate, to: LocalDate, after: UUID?, limit: Int): List<WatchedTrip> {
                if (after == null && !mutated) {
                    mutated = true
                    inner.trips += tripOf(born)
                    inner.trips.removeIf { it.tripId == ids[3] }
                }
                return inner.findOverlapping(from, to, after, limit)
            }
        }

        val order = roundOrder(facade, day, day, pivot, 2).map { it.tripId }

        order shouldBe listOf(ids[3], ids[4], ids[5], born, ids[0], ids[1], ids[2])
    }

    "피벗은 회차 시각에서 결정론적으로 나온다 — 같은 시각은 같은 시작, 다른 회차는 다른 시작(상태 저장 없음)" {
        val at = Instant.parse("2026-08-11T03:15:00Z")
        pivotFor(at) shouldBe pivotFor(at)
        pivotFor(at) shouldNotBe pivotFor(at.plusSeconds(3600))
    }
})
