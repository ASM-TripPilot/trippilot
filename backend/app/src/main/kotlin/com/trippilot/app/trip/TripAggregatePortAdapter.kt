package com.trippilot.app.trip

import com.trippilot.itinerarygeneration.api.ItineraryFacade
import com.trippilot.savedaccommodation.api.TripBaseStayFacade
import com.trippilot.trip.domain.TripAggregatePort
import com.trippilot.trip.domain.TripCounts
import com.trippilot.trip.domain.TripDateRange
import org.springframework.stereotype.Component
import java.util.UUID

/**
 * 여행 카드 집계를 실제로 모아 오는 자리(BR-U6-20·22).
 *
 * **여기 있는 이유**: 숙소(C5)와 일정(C8)이 모두 여행(C6)을 의존한다. 여행 쪽에서 그 둘을 부르면
 * 순환이 되어 빌드가 막히므로, 여행은 [TripAggregatePort] 로 모양만 선언하고 **양쪽을 다 아는
 * 유일한 자리인 `app`** 이 잇는다. 조립을 아는 모듈이 조립을 한다.
 */
@Component
class TripAggregatePortAdapter(
    private val bases: TripBaseStayFacade,
    private val itineraries: ItineraryFacade,
) : TripAggregatePort {

    override fun countsOf(accountId: UUID, trips: List<TripDateRange>): Map<UUID, TripCounts> {
        // 생성 진행 여부는 목록 전체를 한 번에 묻는다 — 여행마다 물으면 목록 길이만큼 조회가 는다
        val running = itineraries.runningGenerationTripIds(accountId, trips.map { it.tripId })
        return trips.associate { trip ->
            // 소유·존재 검증은 퍼사드가 하고, 일정이 없거나 남의 여행이면 null 이 온다.
            val itinerary = itineraries.findCurrent(accountId, trip.tripId)
            trip.tripId to TripCounts(
                // 배정은 날짜별로 오므로 같은 숙소가 여러 번 나온다 — 숙소 **수**는 중복을 뺀 값이다.
                baseCount = bases.findBaseStays(trip.tripId, trip.startDate, trip.endDate)
                    .map { it.savedStayId }
                    .distinct()
                    .size,
                itineraryDayCount = itinerary?.dates?.size ?: 0,
                itineraryStatus = itinerary?.status,
                itineraryGenerationState = itinerary?.generationState,
                itineraryGenerationMode = itinerary?.generationMode,
                // 일정 조회(상세)와 같은 뜻 — 일정이 아직 없는 첫 생성 중에는 상세도 404 라 false 로 둔다
                itineraryGenerating = itinerary != null && trip.tripId in running,
            )
        }
    }
}
