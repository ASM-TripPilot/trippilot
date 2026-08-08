package com.trippilot.itinerarygeneration.application

import com.trippilot.core.error.ResourceNotFound
import com.trippilot.core.error.ValidationFailed
import com.trippilot.core.error.FieldError
import com.trippilot.itinerarygeneration.domain.ItineraryRepository
import com.trippilot.itinerarygeneration.domain.RequestMeta
import com.trippilot.itinerarygeneration.domain.ScheduleAgentPort
import com.trippilot.itinerarygeneration.domain.SlotCandidatesInput
import com.trippilot.itinerarygeneration.domain.SlotCandidatesOutput
import com.trippilot.placedata.api.PoiSurfaceFacade
import com.trippilot.trip.api.TripFacade
import org.springframework.stereotype.Service
import java.time.Clock
import java.util.UUID

/** 슬롯 교체 후보 요청 — 클라이언트가 주는 것은 이만큼이다. 제외 목록은 서버가 만든다. */
data class RequestSlotCandidates(
    val slotKey: String,
    val radiusM: Int?,
    val concept: String?,
)

/**
 * 슬롯 후보 제안(TRIP-311 · DEC-U3-5).
 * 완전 AI("다른 후보 N")와 같이 고르기(옵션 교체)가 **같은 경계**를 쓴다 — 경로별로 API 를 나누지 않는다(BR-U3-23).
 */
@Service
class SlotCandidateService(
    private val trips: TripFacade,
    private val itineraries: ItineraryRepository,
    private val scheduleAgent: ScheduleAgentPort,
    private val poiSurfaces: PoiSurfaceFacade,
    private val clock: Clock,
) {
    fun propose(accountId: UUID, tripId: UUID, request: RequestSlotCandidates): SlotCandidatesOutput {
        trips.findPeriod(accountId, tripId) ?: throw ResourceNotFound() // 소유·존재(404 은닉)
        val itinerary = itineraries.findByTrip(tripId).firstOrNull() ?: throw ResourceNotFound("생성된 일정이 없습니다.")

        val (date, targetPoiId) = SlotKey.parse(request.slotKey)
            ?: throw ValidationFailed(listOf(FieldError("slotKey", "슬롯 키 형식이 올바르지 않습니다.")))

        val day = itinerary.days.firstOrNull { it.date == date }
            ?: throw ResourceNotFound("해당 날짜의 일정이 없습니다.")
        val index = day.slots.indexOfFirst { it.sourcePoiId == targetPoiId }
        if (index < 0) throw ResourceNotFound("해당 슬롯을 찾을 수 없습니다.")

        // 탐색 중심 = 교체 대상 장소의 좌표. 정본에도 동결본에도 없으면 좌표를 지어내지 않는다.
        val center = poiSurfaces.findSurfaces(listOf(targetPoiId))[targetPoiId]
            ?: throw ResourceNotFound("장소 좌표를 찾을 수 없습니다.")

        // 이미 일정에 있는 장소는 제외한다(BR-U3-24). **클라이언트가 아니라 서버가 유도한다** —
        // 클라가 보내는 목록을 믿으면 누락분이 그대로 재추천된다.
        val inItinerary = itinerary.days.flatMap { d -> d.slots.map { it.sourcePoiId } }.distinct()

        return scheduleAgent.proposeSlotCandidates(
            SlotCandidatesInput(
                tripId = tripId,
                slotKey = request.slotKey,
                // 동선 트레이드오프 입력 — 직전·직후 슬롯
                neighborSlotKeys = listOfNotNull(
                    day.slots.getOrNull(index - 1)?.let { SlotKey.of(date, it.sourcePoiId) },
                    day.slots.getOrNull(index + 1)?.let { SlotKey.of(date, it.sourcePoiId) },
                ),
                centerLat = center.lat,
                centerLng = center.lng,
                radiusM = request.radiusM,
                concept = request.concept,
                excludePoiIds = inItinerary,
                requestMeta = RequestMeta(UUID.randomUUID().toString(), clock.instant(), CANDIDATES_DEADLINE_MS),
            ),
        )
    }

    companion object {
        /** 사용자가 화면에서 기다리는 동작이라 생성(20s)보다 훨씬 짧게 잡는다. */
        private const val CANDIDATES_DEADLINE_MS = 3_000L
    }
}
