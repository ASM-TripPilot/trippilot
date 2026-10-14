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
    /**
     * 그날 거리 — 실제 경로가 있으면 그 거리(`ROUTE`), 없으면 방문점 연결선(`VISIT_LINE`)(U10 FD §7.2·§12.5). 소요시간은 없다(INV-3).
     * **U10 전에 만든 요약의 칸은 null 이다** — 모르는 값을 0 으로 채우면 실제 0km 로 읽힌다. 새로 만들거나 경로가 오면 채워진다.
     */
    val distanceKm: Double? = null,
    val distanceSource: DistanceSource? = null,
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

    /**
     * 여행 단위로 잠그고 읽는다(트랜잭션 끝까지). 요약 생성과 경로 갱신이 겹치면 한쪽이 다른 쪽의 커밋 전 상태를 보고 덮는다 —
     * 잠근 **뒤에** 실적·경로를 읽어야 한다. 행이 없어도 잠근다(첫 생성과 갱신이 겹치는 경우).
     */
    fun findForUpdate(tripId: UUID): TripSummary?
}
