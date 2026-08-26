package com.trippilot.reflection.domain

import java.time.Instant
import java.time.LocalDate
import java.util.UUID

/**
 * 여행 요약(U5 정본 §4.2) — 여행당 하나. PK 가 곧 그 보장이다.
 *
 * **비어 있을 수 없다**(PBT-U5-1) — 방문 0곳 여행도 `stats` 를 채운 기본 요약이 나온다.
 */
data class TripSummary(
    val tripId: UUID,
    val narrative: String,
    val highlights: List<DayHighlight>,
    val stats: TripSummaryStats,
    val source: ReflectionSource,
    val generatedAt: Instant,
) {
    init {
        require(narrative.isNotBlank()) { "요약 본문은 비어 있을 수 없습니다(PBT-U5-1)." }
    }
}

/** 날짜별 한 줄(`j04` 의 "Day N · 5곳 · 광안리→감천"). */
data class DayHighlight(
    val date: LocalDate,
    val dayOrder: Int,
    val visitCount: Int,
    val places: List<String>,
)

/**
 * 여행 전체 수치.
 *
 * @property hasLocationData 위치 데이터가 **하나도 없으면** false(BR-U5-39) — 화면은 지도 대신
 *   방문 목록으로 그린다. 좌표 0개인데 지도를 띄우면 빈 지도가 나오고, 사용자는 기록이 없는 줄 안다.
 * @property totalDistanceKm **소요시간은 없다**(INV-3 · PBT-U5-5). 거리만.
 */
data class TripSummaryStats(
    val totalVisits: Int,
    val totalDistanceKm: Double,
    val distanceSource: DistanceSource,
    val totalPhotos: Int,
    val hasLocationData: Boolean,
) {
    init {
        require(totalVisits >= 0 && totalPhotos >= 0) { "수치는 음수일 수 없습니다." }
        require(totalDistanceKm >= 0.0) { "이동 거리는 음수일 수 없습니다." }
    }
}

/** 요약 영속 포트. */
interface TripSummaryRepository {
    /** 여행당 하나 — 재생성은 덮어쓰기다. */
    fun upsert(summary: TripSummary): TripSummary

    fun find(tripId: UUID): TripSummary?
}
