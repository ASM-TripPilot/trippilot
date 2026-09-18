package com.trippilot.reflection.application

import com.trippilot.archive.api.ArchiveDayView
import com.trippilot.archive.api.ArchiveRecordFacade
import com.trippilot.core.error.ResourceNotFound
import com.trippilot.core.event.DomainEventPublisher
import com.trippilot.placedata.api.PoiSurfaceFacade
import com.trippilot.placedata.api.PoiSurfaceView
import com.trippilot.reflection.api.event.ReflectionReady
import com.trippilot.reflection.domain.DayHighlight
import com.trippilot.reflection.domain.DistanceSource
import com.trippilot.reflection.domain.ReflectionSource
import com.trippilot.reflection.domain.TripSummary
import com.trippilot.reflection.domain.TripSummaryRepository
import com.trippilot.reflection.domain.TripSummaryStats
import com.trippilot.trip.api.TripFacade
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import java.time.Clock
import java.util.UUID

/**
 * 여행 요약 생성(BR-U5-39 · US-REC-05).
 *
 * `trip.TripEnded` 수신으로 만들어진다. **여행당 하나**이고 재생성은 덮어쓰기다 — 같은 이벤트가 두 번
 * 배달돼도(at-least-once) 결과가 같다.
 *
 * ⚠ **릴레이는 구독자를 붙인 시점 이후 이벤트만 준다**(TRIP-539 설계). 과거에 끝난 여행은 요약이
 * 생기지 않는다. 소급이 필요하면 별도 배치가 필요하고 그건 이 티켓 밖이다 — 다만 `trip.ended_at` 이
 * 남으므로 나중에 훑을 근거는 있다.
 */
@Service
class TripSummaryService(
    private val trips: TripFacade,
    private val archive: ArchiveRecordFacade,
    private val poiSurfaces: PoiSurfaceFacade,
    private val summaries: TripSummaryRepository,
    private val events: DomainEventPublisher,
    private val clock: Clock,
) {
    /** 이벤트 구독자가 부르는 경로 — 사용자 맥락이 없어 소유 검증을 하지 않는다. */
    @Transactional
    fun generate(tripId: UUID): TripSummary {
        val days = archive.findDailyVisits(tripId)
        val surfaces = poiSurfaces.findSurfaces(days.flatMap { d -> d.visits.map { it.poiId } })
        val summary = TripSummary(
            tripId = tripId,
            narrative = narrativeOf(days, surfaces),
            highlights = highlightsOf(days, surfaces),
            stats = statsOf(days, surfaces),
            source = if (days.isEmpty()) ReflectionSource.BASIC else ReflectionSource.RULE,
            generatedAt = clock.instant(),
        )
        val saved = summaries.upsert(summary)
        events.publish(
            ReflectionReady(
                aggregateId = tripId.toString(),
                tripId = tripId.toString(),
                dayDate = null,
                kind = KIND_SUMMARY,
                source = saved.source.name,
            ),
        )
        return saved
    }

    @Transactional(readOnly = true)
    fun find(accountId: UUID, tripId: UUID): TripSummary? {
        trips.findPeriod(accountId, tripId) ?: throw ResourceNotFound() // 소유·존재(404 은닉)
        return summaries.find(tripId)
    }

    /**
     * **방문 0곳 여행도 비어 있지 않다**(PBT-U5-1). 근거가 없으면 그 사실을 문장으로 쓴다 —
     * 빈 화면을 그리면 사용자는 기록 기능이 고장 난 줄 안다.
     */
    private fun narrativeOf(days: List<ArchiveDayView>, surfaces: Map<UUID, PoiSurfaceView>): String {
        val visits = days.flatMap { it.visits }.filter { !it.skipped }
        if (visits.isEmpty()) return BASIC_SUMMARY
        val names = visits.mapNotNull { surfaces[it.poiId]?.nameKo }.distinct()
        val places = if (names.size <= 3) names.joinToString("·") else names.take(3).joinToString("·") + " 외 ${names.size - 3}곳"
        return "${days.size}일 동안 ${visits.size}곳을 다녀왔어요. $places 이(가) 기억에 남을 거예요."
    }

    private fun highlightsOf(days: List<ArchiveDayView>, surfaces: Map<UUID, PoiSurfaceView>): List<DayHighlight> =
        days.sortedBy { it.date }.mapIndexed { index, day ->
            val done = day.visits.filter { !it.skipped }
            DayHighlight(
                date = day.date,
                dayOrder = index + 1,
                visitCount = done.size,
                // 근거 안에서만 쓴다(BR-U5-31) — 이름을 못 찾은 방문은 넣지 않는다.
                places = done.mapNotNull { surfaces[it.poiId]?.nameKo },
            )
        }

    private fun statsOf(days: List<ArchiveDayView>, surfaces: Map<UUID, PoiSurfaceView>): TripSummaryStats {
        val visits = days.flatMap { it.visits }
        val done = visits.filter { !it.skipped }
        // 날짜별로 이어 잰다 — 날이 바뀌는 사이는 이동이 아니라 숙박이다.
        val km = days.sumOf { day ->
            val pts = day.visits.filter { !it.skipped }.mapNotNull { surfaces[it.poiId] }
            pts.zipWithNext { a, b -> haversineKm(a.lat, a.lng, b.lat, b.lng) }.sum()
        }
        return TripSummaryStats(
            totalVisits = done.size,
            totalDistanceKm = km,
            distanceSource = DistanceSource.VISIT_LINE,
            totalPhotos = visits.sumOf { it.photoCount },
            // 좌표를 하나도 못 찾으면 지도를 그릴 수 없다(BR-U5-39) — 화면이 방문 목록으로 갈아탄다.
            hasLocationData = done.any { surfaces[it.poiId] != null },
        )
    }

    private fun haversineKm(lat1: Double, lng1: Double, lat2: Double, lng2: Double): Double {
        val dLat = Math.toRadians(lat2 - lat1)
        val dLng = Math.toRadians(lng2 - lng1)
        val a = kotlin.math.sin(dLat / 2) * kotlin.math.sin(dLat / 2) +
            kotlin.math.cos(Math.toRadians(lat1)) * kotlin.math.cos(Math.toRadians(lat2)) *
            kotlin.math.sin(dLng / 2) * kotlin.math.sin(dLng / 2)
        return 2 * EARTH_RADIUS_KM * kotlin.math.asin(kotlin.math.min(1.0, kotlin.math.sqrt(a)))
    }

    companion object {
        const val KIND_SUMMARY = "SUMMARY"

        /** 근거가 없을 때(PBT-U5-1). **이 문장이 있는 것 자체가 요구사항이다.** */
        const val BASIC_SUMMARY = "이번 여행은 기록된 방문이 없어요. 다녀온 곳을 남기면 요약이 채워져요."

        private const val EARTH_RADIUS_KM = 6371.0
    }
}
