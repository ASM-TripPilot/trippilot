package com.trippilot.itinerarygeneration.application

import com.trippilot.core.error.ConflictDetected
import com.trippilot.core.error.ResourceNotFound
import com.trippilot.itinerarygeneration.domain.GenerationMode
import com.trippilot.itinerarygeneration.domain.GenerationState
import com.trippilot.itinerarygeneration.domain.Itinerary
import com.trippilot.itinerarygeneration.domain.ItineraryDay
import com.trippilot.itinerarygeneration.domain.ItineraryRepository
import com.trippilot.itinerarygeneration.domain.ItineraryStatus
import com.trippilot.itinerarygeneration.domain.SolveMode
import com.trippilot.itinerarygeneration.domain.VisitSlot
import com.trippilot.placedata.api.FrozenPoiView
import com.trippilot.placedata.api.PoiSurfaceFacade
import com.trippilot.placedata.api.PoiSurfaceView
import com.trippilot.trip.api.TripFacade
import com.trippilot.trip.api.TripPeriod
import io.kotest.assertions.throwables.shouldThrow
import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.collections.shouldContainExactly
import io.kotest.matchers.shouldBe
import java.time.Instant
import java.time.LocalDate
import java.time.LocalTime
import java.util.UUID

/**
 * 숙소 온램프 서비스(US-SCHED-11 · 정본 F-U3-7).
 * 검증 축: **평균 이동 거리 순 정렬**(정본이 명시한 제시 순서) · 좌표 없는 방문지 건너뛰기 · 소유 스코프.
 */
class StayRecommendationServiceTest : StringSpec({

    val acc = UUID.randomUUID()
    val tripId = UUID.randomUUID()
    val d1 = LocalDate.parse("2026-08-10")
    val now = Instant.parse("2026-08-10T00:00:00Z")

    val poiA = UUID.randomUUID()
    val poiB = UUID.randomUUID()

    fun slot(poi: UUID, order: Int) =
        VisitSlot.of(poi, null, order, LocalTime.parse("10:00").plusHours(order.toLong()), LocalTime.parse("11:00").plusHours(order.toLong()))

    fun itinerary(vararg pois: UUID) = Itinerary.reconstitute(
        UUID.randomUUID(), tripId, ItineraryStatus.PLANNED, SolveMode.FULL_AI, GenerationMode.FULLY_AI, false,
        GenerationState.COMPLETE,
        listOf(ItineraryDay.of(d1, 0, pois.mapIndexed { i, p -> slot(p, i) })),
        now, now, null, emptyList(),
    )

    fun trips(owned: Boolean = true) = object : TripFacade {
        override fun findPeriod(accountId: UUID, tripId: UUID) =
            if (owned && accountId == acc) TripPeriod(d1, d1) else null
        override fun findGenerationContext(accountId: UUID, tripId: UUID) = null
    }

    fun repo(stored: Itinerary?) = object : ItineraryRepository {
        override fun save(itinerary: Itinerary) = itinerary
        override fun findById(itineraryId: UUID) = stored
        override fun findByTrip(tripId: UUID) = listOfNotNull(stored)
        override fun replaceForTrip(tripId: UUID, itinerary: Itinerary) = itinerary
        override fun replaceIfCurrent(tripId: UUID, expectedItineraryId: UUID, itinerary: Itinerary) = true
        override fun findStalePartial(updatedBefore: Instant) = emptyList<Itinerary>()
    }

    /** 좌표를 아는 POI 만 담는다 — 나머지는 정본에서 사라진 것으로 본다. */
    fun surfaces(vararg known: Pair<UUID, Pair<Double, Double>>) = object : PoiSurfaceFacade {
        private val map = known.toMap()
        override fun findSurfaces(poiIds: Collection<UUID>) = poiIds.mapNotNull { id ->
            map[id]?.let { (la, ln) -> id to PoiSurfaceView(id, "장소", la, ln, "맛집", null, null, emptyList()) }
        }.toMap()
        override fun findFrozenSurfaces(poiSnapshotIds: Collection<UUID>) = emptyMap<UUID, FrozenPoiView>()
    }

    "평균 이동 거리가 짧은 후보가 먼저 온다 — 정본이 정한 제시 순서(F-U3-7)" {
        val svc = StayRecommendationService(
            trips(), repo(itinerary(poiA, poiB)),
            surfaces(poiA to (33.50 to 126.50), poiB to (33.50 to 126.60)),
        )
        val result = svc.recommend(
            acc, tripId,
            listOf(
                StayCandidate("far", 33.90, 126.50),   // 멀리
                StayCandidate("near", 33.50, 126.55),  // 두 방문지 사이
            ),
        )
        result.candidates.map { it.stayId } shouldContainExactly listOf("near", "far")
        (result.candidates.first().afterAvgDistanceM < result.candidates.last().afterAvgDistanceM) shouldBe true
    }

    "후보를 안 넘기면 권역만 돌려준다 — 지도만 그리는 경우" {
        val svc = StayRecommendationService(
            trips(), repo(itinerary(poiA, poiB)),
            surfaces(poiA to (33.50 to 126.50), poiB to (33.50 to 126.60)),
        )
        val result = svc.recommend(acc, tripId, emptyList())
        result.candidates shouldBe emptyList()
        result.centroidLng shouldBe 126.55
    }

    "좌표를 모르는 방문지는 건너뛴다 — 지어내지 않는다" {
        val svc = StayRecommendationService(
            trips(), repo(itinerary(poiA, poiB)),
            surfaces(poiA to (33.50 to 126.50)), // poiB 는 정본에서 사라짐
        )
        // 남은 한 곳이 곧 무게중심
        svc.recommend(acc, tripId, emptyList()).centroidLng shouldBe 126.50
    }

    "좌표를 아는 방문지가 하나도 없으면 409 — 지도에 찍을 점이 없다" {
        val svc = StayRecommendationService(trips(), repo(itinerary(poiA)), surfaces())
        shouldThrow<ConflictDetected> { svc.recommend(acc, tripId, emptyList()) }
    }

    "생성된 일정이 없으면 404 — 동선이 있어야 권역을 낸다" {
        val svc = StayRecommendationService(trips(), repo(null), surfaces())
        shouldThrow<ResourceNotFound> { svc.recommend(acc, tripId, emptyList()) }
    }

    "미소유 여행이면 404" {
        val svc = StayRecommendationService(trips(owned = false), repo(itinerary(poiA)), surfaces())
        shouldThrow<ResourceNotFound> { svc.recommend(acc, tripId, emptyList()) }
    }
})
