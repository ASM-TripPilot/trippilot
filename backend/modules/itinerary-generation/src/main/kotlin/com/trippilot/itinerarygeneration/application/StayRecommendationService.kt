package com.trippilot.itinerarygeneration.application

import com.trippilot.core.error.ConflictDetected
import com.trippilot.core.error.ResourceNotFound
import com.trippilot.itinerarygeneration.domain.ItineraryRepository
import com.trippilot.placedata.api.PoiSurfaceFacade
import com.trippilot.trip.api.TripFacade
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import java.util.UUID

/** 후보 숙소 1건(클라이언트가 `GET /stays/search` 로 얻어 넘긴다). */
data class StayCandidate(val stayId: String, val lat: Double, val lng: Double)

/** 권역 + 후보 평가 결과. 후보를 안 넘기면 권역만 돌려준다(h27 지도만 그리는 경우). */
data class StayRecommendation(
    val centroidLat: Double,
    val centroidLng: Double,
    val avgDistanceM: Int,
    val candidates: List<ScoredStay>,
)

data class ScoredStay(
    val stayId: String,
    val beforeAvgDistanceM: Int,
    val afterAvgDistanceM: Int,
    val deltaM: Int,
)

/**
 * 숙소 나중 등록 온램프(US-SCHED-11 · 정본 F-U3-7).
 *
 * 숙소 없이 만든 일정의 **방문지 무게중심**으로 권역을 추천하고, 클라이언트가 넘긴 후보를
 * **평균 이동 거리 순**으로 매긴다(before/after 함께).
 *
 * 후보 목록 자체는 여기서 만들지 않는다 — 숙소 검색은 C3(`GET /stays/search`)가 소유하고,
 * 그걸 중개하려고 새 모듈 경계를 열 이유가 없다. **무게중심 최적화**도 하지 않는다(솔버 몫, TRIP-269 AC).
 *
 * 등록 후 재정렬은 **별도 API 가 없다** — 정본이 "숙소 등록 후 재정렬 = `generate`"라고 못박았다
 * (DEC-U3-2·4). 숙소를 등록하면 기존 생성 API 를 다시 부르면 그 숙소가 앵커로 들어간다.
 */
@Service
class StayRecommendationService(
    private val trips: TripFacade,
    private val itineraries: ItineraryRepository,
    private val poiSurfaces: PoiSurfaceFacade,
) {

    @Transactional(readOnly = true)
    fun recommend(accountId: UUID, tripId: UUID, candidates: List<StayCandidate>): StayRecommendation {
        trips.findPeriod(accountId, tripId) ?: throw ResourceNotFound() // 소유·존재(404 은닉)
        val itinerary = itineraries.findByTrip(tripId).firstOrNull()
            ?: throw ResourceNotFound("생성된 일정이 없습니다.")

        // 방문 순서를 그대로 쓴다 — 구간 평균은 순서에 따라 달라진다.
        val poiIds = itinerary.days.flatMap { d -> d.slots.map { it.sourcePoiId } }
        val surfaces = poiSurfaces.findSurfaces(poiIds)
        // 정본에서 사라진 POI 는 좌표가 없다 — 지어내지 않고 건너뛴다.
        val visits = poiIds.mapNotNull { surfaces[it] }.map { StayOnramp.Point(it.lat, it.lng) }

        val region = StayOnramp.regionOf(visits)
            ?: throw ConflictDetected(message = "좌표를 아는 방문지가 없어 권역을 추천할 수 없습니다.")

        val scored = candidates.mapNotNull { c ->
            StayOnramp.scoreCandidate(visits, StayOnramp.Point(c.lat, c.lng))
                ?.let { ScoredStay(c.stayId, it.beforeAvgDistanceM, it.afterAvgDistanceM, it.deltaM) }
        }.sortedBy { it.afterAvgDistanceM } // 평균 이동 거리 순(정본 F-U3-7)

        return StayRecommendation(region.centroid.lat, region.centroid.lng, region.avgDistanceM, scored)
    }
}
