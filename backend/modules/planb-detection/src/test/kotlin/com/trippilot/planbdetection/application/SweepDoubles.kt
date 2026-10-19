package com.trippilot.planbdetection.application

import com.trippilot.trip.api.TripWatchFacade
import com.trippilot.trip.api.WatchedTrip
import java.time.LocalDate
import java.util.UUID

/**
 * PG 의 uuid 순서 — 16바이트를 부호 없이 앞에서부터 비교한다(`uuid_cmp` = memcmp).
 * 자바 `UUID.compareTo` 는 부호 있는 long 비교라 최상위 비트가 선 키에서 PG 와 순서가 뒤집힌다 — 대역은 PG 쪽을 따른다.
 */
internal val PG_UUID_ORDER: Comparator<UUID> =
    compareBy<UUID>({ it.mostSignificantBits.toULong() }, { it.leastSignificantBits.toULong() })

/**
 * 감시 대상 조회 대역 — 실 질의(`TripWatchRepositoryAdapter`)와 같은 술어·순서·키셋·페이지 묶음(1..500)을 따른다.
 * 삭제·종료 기록은 행이 없는 것으로 흉내 낸다(목록에서 빼면 된다). 받은 질의를 [queries] 에 적는다.
 */
internal class InMemoryWatchedTrips(trips: Collection<WatchedTrip> = emptyList()) : TripWatchFacade {
    val trips = trips.toMutableList()
    val queries = mutableListOf<Triple<LocalDate, LocalDate, UUID?>>()

    override fun findOverlapping(from: LocalDate, to: LocalDate, after: UUID?, limit: Int): List<WatchedTrip> {
        queries += Triple(from, to, after)
        return trips.filter { it.endDate >= from && it.startDate <= to }
            .sortedWith(compareBy(PG_UUID_ORDER) { it.tripId })
            .filter { after == null || PG_UUID_ORDER.compare(it.tripId, after) > 0 }
            .take(limit.coerceIn(1, 500))
    }
}
