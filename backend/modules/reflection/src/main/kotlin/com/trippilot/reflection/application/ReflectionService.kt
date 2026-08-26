package com.trippilot.reflection.application

import com.trippilot.archive.api.ArchiveRecordFacade
import com.trippilot.archive.api.ArchiveVisitView
import com.trippilot.core.error.ResourceNotFound
import com.trippilot.core.event.DomainEventPublisher
import com.trippilot.placedata.api.PoiSurfaceFacade
import com.trippilot.placedata.api.PoiSurfaceView
import com.trippilot.reflection.api.event.ReflectionReady
import com.trippilot.reflection.domain.DistanceSource
import com.trippilot.reflection.domain.Reflection
import com.trippilot.reflection.domain.ReflectionRepository
import com.trippilot.reflection.domain.ReflectionStats
import com.trippilot.trip.api.TripFacade
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import java.time.Clock
import java.time.LocalDate
import java.util.UUID
import kotlin.math.asin
import kotlin.math.cos
import kotlin.math.min
import kotlin.math.sin
import kotlin.math.sqrt

/**
 * 하루 회고 생성(US-REC-06 · BR-U5-31~34).
 *
 * **빈 화면을 그리지 않는 것**이 이 서비스의 계약이다(PBT-U5-1). 방문 0곳·사진 0장·메모 0개여도
 * `stats` 를 채운 기본 카드가 나온다 — 폴백 3단(AI → 규칙 → 기본)의 아래 두 단이 여기 있다.
 *
 * **방향은 한쪽뿐이다**: 여기서 `ArchiveRecordFacade` 를 읽고, archive 는 이 모듈을 모른다(BR-U5-51).
 */
@Service
class ReflectionService(
    private val trips: TripFacade,
    private val archive: ArchiveRecordFacade,
    private val poiSurfaces: PoiSurfaceFacade,
    private val reflections: ReflectionRepository,
    private val events: DomainEventPublisher,
    private val clock: Clock,
) {
    /**
     * 그 날의 회고를 만들거나 다시 만든다. 하루 한 장이라 재생성은 **덮어쓰기**다(BR-U5-35).
     *
     * 발행은 같은 트랜잭션 안이다 — 회고는 저장됐는데 알림 이벤트만 사라지는 구간을 만들지 않는다.
     */
    @Transactional
    fun generateDaily(accountId: UUID, tripId: UUID, dayDate: LocalDate): Reflection {
        trips.findPeriod(accountId, tripId) ?: throw ResourceNotFound() // 소유·존재(404 은닉)

        val visits = archive.findDailyVisits(tripId).firstOrNull { it.date == dayDate }?.visits.orEmpty()
        val surfaces = poiSurfaces.findSurfaces(visits.map { it.poiId })
        val stats = statsOf(visits, surfaces)
        // 근거 안에서만 쓴다(BR-U5-31) — 이름을 못 찾은 방문은 문장에 넣지 않는다.
        val placeNames = visits.filter { !it.skipped }.mapNotNull { surfaces[it.poiId]?.nameKo }

        val saved = reflections.upsert(
            Reflection.of(
                tripId = tripId,
                dayDate = dayDate,
                draft = ReflectionNarrator.daily(placeNames, stats),
                source = ReflectionNarrator.sourceFor(stats),
                stats = stats,
                at = clock.instant(),
            ),
        )
        events.publish(
            ReflectionReady(
                aggregateId = saved.reflectionId.toString(),
                tripId = tripId.toString(),
                dayDate = dayDate.toString(),
                kind = KIND_DAILY,
                source = saved.source.name,
            ),
        )
        return saved
    }

    @Transactional(readOnly = true)
    fun find(accountId: UUID, tripId: UUID, dayDate: LocalDate): Reflection? {
        trips.findPeriod(accountId, tripId) ?: throw ResourceNotFound()
        return reflections.find(tripId, dayDate)
    }

    @Transactional(readOnly = true)
    fun listByTrip(accountId: UUID, tripId: UUID): List<Reflection> {
        trips.findPeriod(accountId, tripId) ?: throw ResourceNotFound()
        return reflections.findByTrip(tripId)
    }

    /** 사용자가 문장을 고친다. **초안은 남는다**(INV-U5-06) — 2열 비교의 왼쪽이 그것이다. */
    @Transactional
    fun edit(accountId: UUID, tripId: UUID, dayDate: LocalDate, text: String): Reflection {
        trips.findPeriod(accountId, tripId) ?: throw ResourceNotFound()
        val current = reflections.find(tripId, dayDate) ?: throw ResourceNotFound("회고를 찾을 수 없습니다.")
        return reflections.upsert(current.edit(text, clock.instant()))
    }

    /**
     * 근거 수치. **비어 있을 수 없다**(INV-U5-07) — 방문이 0곳이면 0으로 채운다.
     *
     * 거리는 **방문점 연결선 근사**다(BR-U5-43) — `actual_route_point` 가 미실장이라 서버가 실제
     * 이동 경로를 모른다. 그래서 [DistanceSource.VISIT_LINE] 을 함께 실어, 받는 쪽이 근사값을
     * 실측으로 읽지 않게 한다.
     */
    private fun statsOf(visits: List<ArchiveVisitView>, surfaces: Map<UUID, PoiSurfaceView>): ReflectionStats {
        if (visits.isEmpty()) return ReflectionStats.empty()
        val points = visits.filter { !it.skipped }.mapNotNull { surfaces[it.poiId] }
        val km = points.zipWithNext { a, b -> haversineKm(a.lat, a.lng, b.lat, b.lng) }.sum()
        return ReflectionStats(
            visitCount = visits.count { !it.skipped },
            distanceKm = km,
            distanceSource = DistanceSource.VISIT_LINE,
            photoCount = visits.sumOf { it.photoCount },
        )
    }

    /** 두 점 사이 대권 거리(km). 도로 거리가 아니다 — 그래서 [DistanceSource.VISIT_LINE] 이다. */
    private fun haversineKm(lat1: Double, lng1: Double, lat2: Double, lng2: Double): Double {
        val dLat = Math.toRadians(lat2 - lat1)
        val dLng = Math.toRadians(lng2 - lng1)
        val a = sin(dLat / 2) * sin(dLat / 2) +
            cos(Math.toRadians(lat1)) * cos(Math.toRadians(lat2)) * sin(dLng / 2) * sin(dLng / 2)
        return 2 * EARTH_RADIUS_KM * asin(min(1.0, sqrt(a)))
    }

    companion object {
        const val KIND_DAILY = "DAILY"

        private const val EARTH_RADIUS_KM = 6371.0
    }
}
