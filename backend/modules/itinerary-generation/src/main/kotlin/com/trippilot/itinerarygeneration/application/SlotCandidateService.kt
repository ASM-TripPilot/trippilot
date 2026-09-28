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
import com.trippilot.itinerarygeneration.domain.FreshnessMeta
import com.trippilot.itinerarygeneration.domain.ItineraryRepository
import com.trippilot.itinerarygeneration.domain.RequestMeta
import com.trippilot.itinerarygeneration.domain.ScheduleAgentPort
import com.trippilot.itinerarygeneration.domain.ScoredCandidate
import com.trippilot.itinerarygeneration.domain.ScoredCandidatePool
import com.trippilot.itinerarygeneration.domain.ScoredCandidatePoolStore
import com.trippilot.itinerarygeneration.domain.SlotCandidate
import com.trippilot.itinerarygeneration.domain.SlotCandidatesInput
import com.trippilot.itinerarygeneration.domain.SlotCandidatesOutput
import com.trippilot.itinerarygeneration.domain.SlotCandidatesEmptyReason
import com.trippilot.placedata.api.Area
import com.trippilot.placedata.api.PoiSurfaceFacade
import com.trippilot.placedata.api.PoiSurfaceView
import com.trippilot.trip.api.TripFacade
import org.springframework.stereotype.Service
import java.time.Clock
import java.util.Locale
import java.util.UUID

/** 슬롯 교체 후보 요청 — 클라이언트가 주는 것은 이만큼이다. 제외 목록은 서버가 만든다. */
data class RequestSlotCandidates(
    val slotKey: String,
    val radiusM: Int?,
    val concept: String?,
    /** 교체 사유(FE 카탈로그 코드). 사유 없는 흐름은 null — 번역·검증은 경계 어댑터 몫이다. */
    val reason: String?,
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
    /** 생성 시점 점수 후보 풀(TRIP-969) — 즉답의 재료. 없으면(미생성·http 미개통) 종전 경로 그대로다. */
    private val scoredPools: ScoredCandidatePoolStore,
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

        // 생성 중(PARTIAL) 일괄 409 를 없앴다(TRIP-1000) — day1 조기 노출의 취지가 "보고 고칠 수
        // 있다"인데(BR-U3-06), 2차가 도는 10분간 이미 도착한 1일차까지 잠겼다(QA #073 실측).
        // 이미 만들어진 일자는 통과시키고, **아직 없는 일자만** 아래에서 409 로 가른다.
        val day = itinerary.days.firstOrNull { it.date == date }
            ?: if (itinerary.generationState == GenerationState.PARTIAL) {
                // 404 로 내면 "일정이 없다"로 읽힌다 — 사실은 "아직 만드는 중"이다(INV-4 침묵 금지).
                throw ConflictDetected(message = "그 일자는 아직 만드는 중입니다. 완료 후 교체할 수 있습니다.")
            } else {
                throw ResourceNotFound("해당 날짜의 일정이 없습니다.")
            }
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

        // 즉답(TRIP-969) — 이 판단은 생성 때 이미 끝나 있다. 저장된 점수 후보가 요청을 덮으면
        // AI 왕복(LLM 1회·예산 25초) 없이 답한다. 전개(느린 경로) 조건 셋, 전부 불리언:
        // concept 이 있다(저장 점수는 "이런 느낌으로"를 모른다) · 요청 반경 > 저장 반경(풀이 안 덮는다) ·
        // 같은 카테고리 예비 0건(storedAnswer 가 null). 교체 대상이 풀에 없어도 전개한다.
        val stored = scoredPools.find(tripId)
        val fastProposed = stored
            ?.takeIf { request.concept.isNullOrBlank() }
            ?.takeIf { request.radiusM == null || request.radiusM <= it.radiusM }
            ?.let { storedAnswer(it, targetPoiId, request.radiusM, center, inItinerary) }

        // 경계 실패를 그대로 흘리면 RuntimeException 이라 전역 핸들러가 500 으로 떨군다 —
        // "우리가 터졌다"가 아니라 "지금은 못 준다"가 사실이다(AI 미도달 시 어댑터가 로컬 폴백까지
        // 마친 뒤라, 여기까지 예외가 오면 로컬 풀 조회조차 실패한 것이다).
        // openapi 도 이 오퍼레이션에 5xx 를 약속한 적이 없다. 503 + 폴백 없음으로 표면화한다(RESILIENCY-10).
        val proposed = fastProposed ?: try {
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
                    reason = request.reason,
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

        // 전개 결과가 저장분보다 나쁘면 저장분을 준다(TRIP-969) — 지금보다 나빠지는 경우 0.
        // concept 요청은 대상이 아니다: 저장 점수는 그 요구를 모르므로 0건이 정직한 답일 수 있다.
        val answered = if (fastProposed == null && proposed.candidates.isEmpty() &&
            stored != null && request.concept.isNullOrBlank()
        ) {
            storedAnswer(stored, targetPoiId, request.radiusM, center, inItinerary) ?: proposed
        } else {
            proposed
        }

        // closed-set 재확인(INV-1) — 경계 너머가 지어낸 poiId 가 클라이언트로 나가면 그대로 일정에 들어간다.
        // 편집 경로에 POI 실재 검사가 없어 여기서 막지 않으면 확정 동결까지 흘러간다.
        val groundedById = candidatePool.ground(answered.candidates.map { it.poiId }).associateBy { it.poiId }
        val kept = answered.candidates.filter { it.poiId in groundedById }
        if (kept.size != answered.candidates.size) {
            log.warn(
                "후보 {}건이 정본에 없어 제외했습니다 — 경계가 closed-set 을 벗어났습니다(INV-1). tripId={}",
                answered.candidates.size - kept.size, tripId,
            )
        }

        // 컨셉 필터(TRIP-1065 · QA #042) — '식사'를 골라도 명소가 오던 결함. concept 은 AI 계약에
        // 자리가 없어 경계에서 버려지므로, **모든 경로**(AI LLM·규칙 폴백·로컬 폴백)의 결과를 여기
        // 한 곳에서 거른다. 필터는 풀을 좁힐 뿐 넓히지 않는다(INV-1). 미매핑 컨셉(자유 문자열·
        // 구버전 앱)은 400 이 아니라 필터 없음 + 로그 1줄(reason 선례).
        val conceptSet = ConceptCategories.of(request.concept)
        if (conceptSet == null) {
            if (!request.concept.isNullOrBlank()) {
                log.info("매핑에 없는 컨셉 — 필터 없이 응답합니다. concept={} tripId={}", request.concept, tripId)
            }
            return answered.copy(candidates = kept)
        }
        val matched = kept.filter { groundedById.getValue(it.poiId).category in conceptSet }
        if (matched.isNotEmpty()) return answered.copy(candidates = matched)

        // 경계가 컨셉 밖 후보만 줬다(예: LLM 빈 결과 → 규칙 폴백이 카테고리를 모름). 컨셉 카테고리로
        // 풀을 직접 봐서 채운다 — 반경 안에 맛집이 실재하는데 "주변에 없음"이라 말하면 거짓이다.
        return conceptRefill(request.concept!!, conceptSet, center, inItinerary, targetPoiId, answered)
    }

    /**
     * 컨셉 카테고리 풀 채움(TRIP-1065) — closed-set 풀([CandidatePoolPort]) 그대로, 거리순.
     * AI 순위가 아니므로 **degraded=true 로 정직하게** 표시한다(INV-4). 0건이면 로컬 폴백과 같은
     * 규약으로 사유를 가른다(BR-U3-25): 반경을 한 번 넓혀 보고, 그래도 없으면 NO_NEARBY,
     * 있는데 전부 일정에 들어 있으면 ALL_IN_ITINERARY.
     */
    private fun conceptRefill(
        concept: String,
        categories: Set<String>,
        center: PoiSurfaceView,
        inItinerary: List<UUID>,
        targetPoiId: UUID,
        base: SlotCandidatesOutput,
    ): SlotCandidatesOutput {
        val excluded = inItinerary.toSet()
        fun search(radiusM: Int) = candidatePool
            .resolve(Area.Radius(center.lat, center.lng, radiusM.toDouble()), categories)
            .filterNot { it.poiId == targetPoiId }
            .sortedBy { it.distanceM ?: Double.MAX_VALUE }

        var radius = base.radiusMUsed
        var nearby = search(radius)
        var found = nearby.filterNot { it.poiId in excluded }
        if (found.isEmpty() && radius < CONCEPT_WIDENED_RADIUS_M) {
            radius = CONCEPT_WIDENED_RADIUS_M
            nearby = search(radius)
            found = nearby.filterNot { it.poiId in excluded }
        }
        return base.copy(
            candidates = found.take(MAX_STORED_CANDIDATES).map {
                SlotCandidate(
                    poiId = it.poiId,
                    // 거리만 — 소요시간은 어떤 이유로도 내보내지 않는다(INV-3).
                    distanceRange = it.distanceM?.let { m -> "약 ${"%.1f".format(Locale.ROOT, m / 1000)}km" }
                        ?: "거리 미확인",
                    // 필터를 통과한 카테고리라 이 문구는 참이다(BR-U2-09 — 시각·소요시간 언급 없음).
                    rationale = "$concept 컨셉에 맞는 ${it.category}",
                )
            },
            radiusMUsed = radius,
            freshness = FreshnessMeta(clock.instant(), degraded = true),
            emptyReason = when {
                found.isNotEmpty() -> null
                nearby.isEmpty() -> SlotCandidatesEmptyReason.NO_NEARBY
                else -> SlotCandidatesEmptyReason.ALL_IN_ITINERARY
            },
        )
    }

    /**
     * 저장 풀에서 **같은 카테고리 예비**를 골라 즉답을 만든다(TRIP-969) — 생성 때의 판단
     * "같은 카테고리 → 점수 내림 → 거리 오름" 그대로, LLM 0회.
     *
     * null = 즉답 불가 — 교체 대상이 풀에 없어 카테고리를 모르거나, 같은 카테고리 예비가
     * (반경 안에) 0건이다. 그때 호출측이 전개(느린 경로)로 간다.
     *
     * 거리·실재 확인은 [CandidatePoolPort.resolve] 재사용 — ACTIVE 만 오고 거리 의미가
     * 로컬 폴백([LocalSlotCandidateSource])과 같아진다. 생성 뒤 비활성된 후보는 여기서 걸러진다.
     */
    private fun storedAnswer(
        pool: ScoredCandidatePool,
        targetPoiId: UUID,
        radiusM: Int?,
        center: PoiSurfaceView,
        inItinerary: List<UUID>,
    ): SlotCandidatesOutput? {
        val category = pool.candidates.firstOrNull { it.poiId == targetPoiId }?.category ?: return null
        val excluded = inItinerary.toSet()
        val spares = pool.candidates.filter { it.category == category && it.poiId != targetPoiId && it.poiId !in excluded }
        if (spares.isEmpty()) return null

        val usedRadius = radiusM ?: pool.radiusM
        val nearby = candidatePool
            .resolve(Area.Radius(center.lat, center.lng, usedRadius.toDouble()), emptySet())
            .associateBy { it.poiId }
        val measured = spares.mapNotNull { c -> nearby[c.poiId]?.let { c to it.distanceM } }
        if (measured.isEmpty()) return null

        return SlotCandidatesOutput(
            candidates = measured
                .sortedWith(
                    compareByDescending<Pair<ScoredCandidate, Double?>> { it.first.score }
                        .thenBy { it.second ?: Double.MAX_VALUE },
                )
                .take(MAX_STORED_CANDIDATES)
                .map { (c, distanceM) ->
                    SlotCandidate(
                        poiId = c.poiId,
                        // 거리만 — 소요시간은 어떤 이유로도 내보내지 않는다(INV-3).
                        distanceRange = distanceM?.let { m -> "약 ${"%.1f".format(Locale.ROOT, m / 1000)}km" }
                            ?: "거리 미확인",
                        // 시각·소요시간을 언급하지 않는다(BR-U2-09). concept 요청은 전개로 갔으므로 여기 없다.
                        rationale = "주변 ${c.category}",
                    )
                },
            radiusMUsed = usedRadius,
            // 강등이 아니다 — 생성 시점 **AI 자신의 판단**을 재사용한 것이라 로컬 폴백(거리순)과 다르다.
            freshness = FreshnessMeta(clock.instant(), degraded = false),
            emptyReason = null, // 이 경로는 0건이면 null 을 돌려줘 전개로 간다 — 0건 응답이 없다
        )
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

        /** 즉답 후보 상한 — 로컬 폴백([LocalSlotCandidateSource])과 같은 개수를 준다. */
        private const val MAX_STORED_CANDIDATES = 5

        /** 컨셉 채움의 넓힌 반경 — 로컬 폴백(h15 "반경 넓힘")과 같은 값. */
        private const val CONCEPT_WIDENED_RADIUS_M = 12_000
    }
}
