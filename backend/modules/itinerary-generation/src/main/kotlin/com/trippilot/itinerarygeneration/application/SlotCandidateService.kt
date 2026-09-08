package com.trippilot.itinerarygeneration.application

import com.trippilot.core.error.ConflictDetected
import com.trippilot.itinerarygeneration.domain.GenerationState
import com.trippilot.itinerarygeneration.domain.ItineraryStatus
import com.trippilot.placedata.api.CandidatePoolPort
import com.trippilot.core.error.ResourceNotFound
import com.trippilot.core.error.UpstreamUnavailable
import com.trippilot.itinerarygeneration.domain.ScheduleAgentCallFailed
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

        // 경계 실패를 그대로 흘리면 RuntimeException 이라 전역 핸들러가 500 으로 떨군다 —
        // "우리가 터졌다"가 아니라 "지금은 못 준다"가 사실이다(AI 미도달 시 어댑터가 로컬 폴백까지
        // 마친 뒤라, 여기까지 예외가 오면 로컬 풀 조회조차 실패한 것이다).
        // openapi 도 이 오퍼레이션에 5xx 를 약속한 적이 없다. 503 + 폴백 없음으로 표면화한다(RESILIENCY-10).
        val proposed = try {
            scheduleAgent.proposeSlotCandidates(
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
                    placementReason = matches.single().value.placementReason,
                    requestMeta = RequestMeta(UUID.randomUUID().toString(), clock.instant(), CANDIDATES_DEADLINE_MS),
                ),
            )
        } catch (e: ScheduleAgentCallFailed) {
            log.warn("슬롯 후보 제안 실패 — 503 으로 표면화합니다(폴백 없음). tripId={} errorCode={}", tripId, e.errorCode, e)
            throw UpstreamUnavailable(
                source = "schedule-agent",
                fallbackApplied = false, // 후보는 지어낼 수 없다(INV-1) — 빈 목록은 "주변에 없음"과 구분되지 않는다
                message = "장소 추천을 지금 이용할 수 없습니다. 잠시 후 다시 시도해 주세요.",
                cause = e,
            )
        }

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
        /**
         * 3s → 15s (2026-09-08, 팀 결정). 사용자가 화면에서 기다리는 동작이라 처음엔 생성(20s)보다
         * 훨씬 짧게 잡았는데, 그 예산에서는 AI 가 이 경로에 배정한 상위 티어 모델(`gpt-5.6-sol`)이
         * **사실상 못 탄다** — 실측 중앙값 6.8s 인데 AI 가 예산의 70% 를 LLM 몫으로 떼면 3s × 0.7 =
         * 2.1s 라 매번 규칙 폴백으로 떨어진다. 응답은 200 이라 증상이 안 보인다.
         *
         * 15s × 0.7 = 10.5s — sol 중앙값의 1.5배. 꼬리(최대 21s)는 여전히 폴백이 받는다.
         * "시간 부족으로 sol 을 못 타는 경우가 없게" 가 우선이라 필요하면 더 올린다.
         *
         * 15s → 25s (2026-09-08, 2단 폴백). AI 가 1차 타임아웃 시 다른 벤더 모델로 한 번 더 부르게
         * 되면서 예산을 셋으로 나눈다 — 1차 50%(12.5s, sol 실측 최대 7.8s 에 여유) · 재시도 35%
         * (8.75s, claude-opus-5 실측 최대 7.8s) · 검색·직렬화 15%. 실측에서 sol 보다 빠른 모델은
         * 없었으므로(terra 5.2s·opus 7.6s vs sol 5.0s) 재시도 예산은 줄일 수 없고, 1차 몫을 줄이면
         * sol 이 못 탄다 — 그래서 총액이 오른다. 정상 경로(sol 성공)의 대기는 그대로 ~5s 다.
         *
         * HTTP 읽기 타임아웃은 이 값과 무관하게 `ScheduleDeadlineProperties.editWaitMs`(기본 60s)에서
         * 온다 — 그쪽이 더 크므로 이 상수만 올려도 끊기지 않는다. 그 관계가 뒤집히면 여기 값이
         * 조용히 무효가 되니 같이 본다.
         *
         * http 모드에서 이 값은 `request_meta.deadline_ms` 로 AI `alternatives` 에 실려 나간다 —
         * AI 미도달 시에만 `HttpScheduleAgentAdapter` 가 로컬 풀로 폴백한다(D-4가).
         */
        private const val CANDIDATES_DEADLINE_MS = 25_000L

        /** place-data 반경 조회 상한과 같은 값 — 전 DB 스캔 차단. */
        const val MAX_RADIUS_M = 50_000
    }
}
