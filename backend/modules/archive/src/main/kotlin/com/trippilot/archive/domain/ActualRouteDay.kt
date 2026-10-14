package com.trippilot.archive.domain

import java.time.Instant
import java.time.LocalDate
import java.util.UUID

/**
 * 하루치 실제 경로(U10 FD domain-entities §3). 서버가 갖는 위치 형태의 데이터는 이것뿐이다(INV-U10-2).
 *
 * 소요시간·속도 칸이 없다(INV-3 · INV-U10-7). [recordedFrom]/[recordedTo] 는 거리 상한을 재는 데만 쓰고 내보내지 않는다.
 */
data class ActualRouteDay(
    val routeDayId: UUID,
    val tripId: UUID,
    val localDate: LocalDate,
    val segments: List<String>,
    val distanceM: Int,
    val distanceClamped: Boolean,
    val rawPointCount: Int,
    val storedPointCount: Int,
    val recordedFrom: Instant?,
    val recordedTo: Instant?,
    val createdAt: Instant,
    val updatedAt: Instant,
)

interface ActualRouteDayRepository {
    /** 같은 날이 있으면 내용을 통째로 바꾼다(재업로드 = 전체 교체). 행 id 는 처음 것을 유지한다. */
    fun upsert(day: ActualRouteDay): ActualRouteDay

    fun findByTrip(tripId: UUID): List<ActualRouteDay>

    /** 그 여행들의 경로를 모두 지운다. 지운 건수. */
    fun deleteByTrips(tripIds: List<UUID>): Int
}
