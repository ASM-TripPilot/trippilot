package com.trippilot.itinerarygeneration.application

import com.trippilot.core.error.ConflictDetected
import com.trippilot.itinerarygeneration.domain.GenerationState
import com.trippilot.itinerarygeneration.domain.ItineraryStatus
import com.trippilot.placedata.api.CandidatePoolPort
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
    private val candidatePool: CandidatePoolPort,
    private val clock: Clock,
) {
    fun propose(accountId: UUID, tripId: UUID, request: RequestSlotCandidates): SlotCandidatesOutput {
        // 형식 검사를 먼저 — 일정이 없더라도 잘못된 요청은 400 이어야 한다(404 로 덮으면 원인을 오인한다).
        val (date, targetPoiId) = SlotKey.parse(request.slotKey)
            ?: throw ValidationFailed(listOf(FieldError("slotKey", "슬롯 키 형식이 올바르지 않습니다.")))
        // 상한 없이 두면 바운딩박스가 전 지구를 덮어 ACTIVE 전 행을 읽는다 — place-data 의 반경 조회가
        // 이미 같은 이유로 50km 상한을 둔다(PoiReadService). 여기만 열어두면 그 방어가 무의미해진다.
        if (request.radiusM != null && request.radiusM > MAX_RADIUS_M) {
            throw ValidationFailed(listOf(FieldError("radiusM", "탐색 반경은 ${MAX_RADIUS_M / 1000}km 이하입니다.")))
        }

        trips.findPeriod(accountId, tripId) ?: throw ResourceNotFound() // 소유·존재(404 은닉)
        val itinerary = itineraries.findByTrip(tripId).firstOrNull() ?: throw ResourceNotFound("생성된 일정이 없습니다.")

        // 적용할 수 없는 일정에 후보를 제안하지 않는다 — 골라도 편집이 409 로 막힌다.
        if (itinerary.status != ItineraryStatus.PLANNED) {
            throw ConflictDetected(message = "확정된 일정은 슬롯을 교체할 수 없습니다.")
        }
        if (itinerary.generationState == GenerationState.PARTIAL) {
            throw ConflictDetected(message = "일정 생성이 진행 중입니다. 완료 후 교체할 수 있습니다.")
        }

        val day = itinerary.days.firstOrNull { it.date == date }
            ?: throw ResourceNotFound("해당 날짜의 일정이 없습니다.")
        val matches = day.slots.withIndex().filter { it.value.sourcePoiId == targetPoiId }
        if (matches.isEmpty()) throw ResourceNotFound("해당 슬롯을 찾을 수 없습니다.")
        // slotKey 규약이 "{date}#{poiId}" 라(BR-U2-04) 같은 날 같은 장소가 둘이면 어느 쪽인지 알 수 없다.
        // 조용히 첫 번째를 고르면 사용자가 저녁 슬롯을 보며 아침 슬롯의 이웃을 받게 된다 — 실패로 드러낸다.
        if (matches.size > 1) {
            throw ConflictDetected(message = "같은 날 같은 장소가 여러 번 있어 어느 슬롯인지 특정할 수 없습니다.")
        }
        val index = matches.single().index

        // 탐색 중심 = 교체 대상 장소의 좌표. 정본에 없으면(하드 삭제) 좌표를 지어내지 않고 실패시킨다.
        val center = poiSurfaces.findSurfaces(listOf(targetPoiId))[targetPoiId]
            ?: throw ResourceNotFound("장소 좌표를 찾을 수 없습니다.")

        // 이미 일정에 있는 장소는 제외한다(BR-U3-24). **클라이언트가 아니라 서버가 유도한다** —
        // 클라가 보내는 목록을 믿으면 누락분이 그대로 재추천된다.
        val inItinerary = itinerary.days.flatMap { d -> d.slots.map { it.sourcePoiId } }.distinct()

        val proposed = scheduleAgent.proposeSlotCandidates(
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

        // closed-set 재확인(INV-1) — 경계 너머가 지어낸 poiId 가 클라이언트로 나가면 그대로 일정에 들어간다.
        // 편집 경로에 POI 실재 검사가 없어 여기서 막지 않으면 확정 동결까지 흘러간다.
        val grounded = candidatePool.ground(proposed.candidates.map { it.poiId }).map { it.poiId }.toSet()
        val kept = proposed.candidates.filter { it.poiId in grounded }
        if (kept.size != proposed.candidates.size) {
            log.warn(
                "후보 {}건이 정본에 없어 제외했습니다 — 경계가 closed-set 을 벗어났습니다(INV-1). tripId={}",
                proposed.candidates.size - kept.size, tripId,
            )
        }
        return proposed.copy(candidates = kept)
    }

    private val log = org.slf4j.LoggerFactory.getLogger(SlotCandidateService::class.java)

    companion object {
        /** 사용자가 화면에서 기다리는 동작이라 생성(20s)보다 훨씬 짧게 잡는다. */
        private const val CANDIDATES_DEADLINE_MS = 3_000L

        /** place-data 반경 조회 상한과 같은 값 — 전 DB 스캔 차단. */
        const val MAX_RADIUS_M = 50_000
    }
}
