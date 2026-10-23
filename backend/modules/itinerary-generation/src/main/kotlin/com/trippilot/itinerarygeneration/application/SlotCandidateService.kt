package com.trippilot.itinerarygeneration.application

import com.trippilot.itinerarygeneration.api.SlotCandidateFacade
import com.trippilot.itinerarygeneration.api.SlotCandidateView
import com.trippilot.itinerarygeneration.api.SlotCandidatesView
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
import com.trippilot.itinerarygeneration.domain.Itinerary
import com.trippilot.itinerarygeneration.domain.ItineraryRepository
import com.trippilot.itinerarygeneration.domain.RepairContext
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
import com.trippilot.placedata.api.GroundedPlace
import com.trippilot.placedata.api.RegionCenter
import com.trippilot.placedata.api.PoiSurfaceFacade
import com.trippilot.profile.api.overriddenBy
import com.trippilot.trip.api.TripFacade
import com.trippilot.profile.api.PreferenceFacade
import com.trippilot.itinerarygeneration.domain.PersonalizationPort
import org.springframework.stereotype.Service
import java.time.Clock
import java.time.LocalDate
import java.time.ZoneId
import java.util.Locale
import java.util.UUID

/** 슬롯 교체 후보 요청 — 클라이언트가 주는 것은 이만큼이다. 제외 목록은 서버가 만든다. */
data class RequestSlotCandidates(
    val slotKey: String,
    val radiusM: Int?,
    val concept: String?,
    /** 교체 사유(FE 카탈로그 코드). 사유 없는 흐름은 null — 번역·검증은 경계 어댑터 몫이다. */
    val reason: String?,
    /**
     * 같이 고르기(순차 채우기)인가 — **탐색 중심을 어디로 둘지만 가른다**(TRIP-1252).
     *
     * 두 경로가 같은 경계를 쓰지만(BR-U3-23) 맥락이 다르다. 완전 AI '다른 후보'는 "이 자리 대체"라
     * 교체 대상이 중심이고, 같이 고르기는 **방금 고른 곳에서 다음 발걸음**이라 직전 슬롯이 중심이다.
     *
     * **직전 POI 를 클라가 보내지 않는다** — 경로만 선언받고 좌표 원천은 서버가 일정에서 유도한다
     * (제외 목록을 서버가 만드는 것과 같은 이유: 클라가 준 식별자를 믿으면 그쪽 누락이 그대로 샌다).
     */
    val coPick: Boolean = false,
    /** 찾는 중심을 사용자가 골랐는가(2026-10-23). null 이면 위 [coPick] 규칙 그대로다. */
    val center: CandidateCenter? = null,
)

/**
 * 찾는 중심 — 같이 짜기에서 사용자가 고른다(2026-10-23 사용자 결정: 방금 고른 곳 · 고른 지역(구) 중심 · 숙소 · 지도에서 찍기).
 * [lat]·[lng] 는 [CenterMode.POINT] 에서만 쓰고 그때는 필수다. 나머지 좌표는 클라가 보내지 않는다 — 서버가 일정·여행에서 읽는다.
 */
data class CandidateCenter(val mode: CenterMode, val lat: Double? = null, val lng: Double? = null)

enum class CenterMode {
    /** 방금 고른 곳(직전 슬롯). 첫 칸이면 교체 대상. */
    PREVIOUS,

    /** 그 날 목적지(구) 중심. */
    REGION,

    /** 그 날 숙소(체크아웃일은 전날 숙소). */
    STAY,

    /** 지도에서 찍은 점. */
    POINT,
}

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
    /** 그 여행의 취향(BR-U1-38) — 생성과 같은 척도로 후보를 고르게. 계정 취향은 안 실린 축만. */
    private val preferences: PreferenceFacade,
    private val personalization: PersonalizationPort,
    /** 적합 판정에 실을 수단·앵커 — 편집 저장([EditItineraryService])과 같은 출처. 빼면 두 판정이 갈린다. */
    private val repairContexts: RepairContexts,
) : SlotCandidateFacade {
    /** 공개 퍼사드 — REST 와 같은 경로를 탄다. 반경·컨셉·사유를 고르는 화면이 없는 호출측(도우미)이라 기본값으로 묻는다. */
    override fun propose(accountId: UUID, tripId: UUID, slotKey: String): SlotCandidatesView =
        propose(accountId, tripId, RequestSlotCandidates(slotKey, radiusM = null, concept = null, reason = null)).let { out ->
            SlotCandidatesView(
                out.candidates.map { SlotCandidateView(it.poiId, it.distanceRange, it.rationale) },
                out.freshness.degraded,
                out.emptyReason?.name,
            )
        }

    fun propose(accountId: UUID, tripId: UUID, request: RequestSlotCandidates): SlotCandidatesOutput {
        // 형식 검사를 먼저 — 일정이 없더라도 잘못된 요청은 400 이어야 한다(404 로 덮으면 원인을 오인한다).
        val (date, targetPoiId) = SlotKey.parse(request.slotKey)
            ?: throw ValidationFailed(listOf(FieldError("slotKey", "슬롯 키 형식이 올바르지 않습니다.")))
        // 상한 없이 두면 바운딩박스가 전 지구를 덮어 ACTIVE 전 행을 읽는다 — place-data 의 반경 조회가
        // 이미 같은 이유로 50km 상한을 둔다(PoiReadService). 여기만 열어두면 그 방어가 무의미해진다.
        if (request.radiusM != null && request.radiusM > MAX_RADIUS_M) {
            throw ValidationFailed(listOf(FieldError("radiusM", "탐색 반경은 ${MAX_RADIUS_M / 1000}km 이하입니다.")))
        }
        val point = request.center?.takeIf { it.mode == CenterMode.POINT }?.let { c ->
            val lat = c.lat
            val lng = c.lng
            if (lat == null || lng == null || lat !in -90.0..90.0 || lng !in -180.0..180.0) {
                throw ValidationFailed(listOf(FieldError("center", "지도에서 찍은 위치(lat·lng)가 필요합니다.")))
            }
            RegionCenter(lat, lng)
        }

        val period = trips.findPeriod(accountId, tripId) ?: throw ResourceNotFound() // 소유·존재(404 은닉)
        val itinerary = itineraries.findByTrip(tripId).firstOrNull() ?: throw ResourceNotFound("생성된 일정이 없습니다.")

        // 적용할 수 없는 일정에 후보를 제안하지 않는다 — 골라도 편집이 409 로 막힌다. 그래서 잠금 범위는 편집과
        // **같아야 한다**: 확정 일정은 여행 시작 전만 잠긴다(TRIP-999 결정 (a), EditItineraryService). 여기만
        // 확정 전체를 막아 두면 여행 중에는 고칠 수는 있는데 바꿀 곳을 고를 수가 없었다.
        if (itinerary.status == ItineraryStatus.CONFIRMED && LocalDate.ofInstant(clock.instant(), TRAVEL_ZONE) < period.startDate) {
            throw ConflictDetected(message = "확정된 일정은 여행이 시작되기 전에는 슬롯을 교체할 수 없습니다.")
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

        // 탐색 중심 — 기본은 교체 대상 장소다. 같이 고르기만 **직전 슬롯**으로 옮긴다(TRIP-1252).
        //
        // 같이 고르기는 선택할 때마다 일정에 저장하고 다음 칸으로 전진하므로, 이 시점의
        // `slots[index - 1]` 은 **사용자가 방금 고른 그 장소**다(AI 원배치가 아니다). 그걸 중심으로
        // 쓰지 않으면 칸을 고를수록 동선이 도시 전체로 튄다 — 경산 당일치기 6칸에서 남서↔북동을
        // 오가는 것으로 재현됐다(2026-10-05). 후보 거리 문구도 같은 중심에서 나오므로 함께 고쳐진다.
        //
        // 시간대·카테고리 다양성은 여기서 보정하지 않는다 — 상대 랭킹의 몫이다(결정 1 단서).
        //
        // 사용자가 중심을 고르면(2026-10-23) 그걸 쓴다 — 고른 재료가 없으면(숙소 없는 날) 조용히 다른 중심으로 바꾸지 않고 409.
        val mode = request.center?.mode
        // 지연 조회 — 후보 0건·중심이 직전/교체 대상이면 DB 를 더 읽지 않는다. 조회 실패를 여기서 삼키지 않는다 —
        // REGION·STAY 에서 "숙소가 없다"(409)로 바뀌면 사유가 거짓이 된다. 구 안 우선만 아래에서 물러선다.
        val space by lazy { repairContexts.forSlotCandidates(accountId, tripId, date) }
        fun slotCenter(): RegionCenter {
            val previousPoiId = if (mode == CenterMode.PREVIOUS || (mode == null && request.coPick)) day.slots.getOrNull(index - 1)?.sourcePoiId else null
            val surfaces = poiSurfaces.findSurfaces(listOfNotNull(previousPoiId, targetPoiId))
            // 정본에 없으면(하드 삭제) 좌표를 지어내지 않는다. 다만 **직전** 슬롯이 사라진 것은 이 요청의
            // 잘못이 아니라, 교체 대상으로 물러서고 그 사실을 로그로 남긴다(조용히 틀리지 않게).
            val surface = previousPoiId?.let { prev ->
                surfaces[prev] ?: null.also {
                    log.warn("직전 슬롯 장소가 정본에 없어 교체 대상을 중심으로 씁니다. tripId={} previousPoiId={}", tripId, prev)
                }
            } ?: surfaces[targetPoiId] ?: throw ResourceNotFound("장소 좌표를 찾을 수 없습니다.")
            return RegionCenter(surface.lat, surface.lng)
        }
        val center = point ?: when (mode) {
            CenterMode.REGION -> space.regionCenter ?: throw ConflictDetected(message = "고른 지역의 중심을 찾을 수 없습니다. 다른 기준을 골라 주세요.")
            CenterMode.STAY -> space.stay ?: throw ConflictDetected(message = "이 날은 숙소가 없습니다. 다른 기준을 골라 주세요.")
            else -> slotCenter()
        }

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
                ).withTripPreference(accountId, tripId),
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

        // 어느 갈래(즉답·AI·풀 채움)로 골랐든 반환 직전 **한 곳**에서 슬롯 시각 적합 판정을 거친다.
        val chosen = chooseCandidates(request, answered, center, inItinerary, targetPoiId, tripId)
        // 구 안 우선은 중심을 서버가 정할 때만 건다 — 숙소·찍은 점은 사용자가 그 자리를 고른 것이라 구 밖이어도 그 근처가 답이다.
        val placed = if (chosen.candidates.isEmpty() || point != null || mode == CenterMode.STAY) {
            chosen
        } else {
            val districtCodes = runCatching { space.districtCodes }.getOrElse { e ->
                log.warn("슬롯 후보 공간 재료(구) 조회 실패 — 구 안 우선 없이 답합니다. tripId={}", tripId, e)
                emptySet()
            }
            inDistrictFirst(chosen, districtCodes, center, request.concept, inItinerary, targetPoiId)
        }
        // 구 안 우선은 대체 후보를 **뒤에 덧붙여** 넘기고, 개수는 판정 뒤에 원래대로 자른다 — 먼저 자르면 시각에 맞던 후보가
        // 판정 전에 사라진다.
        return keepFitting(placed, itinerary, date, index, accountId, tripId, request.slotKey, limit = chosen.candidates.size)
    }

    /** closed-set 재확인 → 컨셉 필터·풀 채움. [answered] 는 즉답이거나 AI 응답이다. */
    private fun chooseCandidates(
        request: RequestSlotCandidates,
        answered: SlotCandidatesOutput,
        center: RegionCenter,
        inItinerary: List<UUID>,
        targetPoiId: UUID,
        tripId: UUID,
    ): SlotCandidatesOutput {
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

        // 컨셉 필터(TRIP-1065 · QA #042) — '식사'를 골라도 명소가 오던 결함. AI 요청에도 categories 로
        // 실리지만(풀 단계 필터) 상대가 무시할 수 있고 로컬 폴백은 모르므로, **모든 경로**(AI LLM·규칙
        // 폴백·로컬 폴백)의 결과를 여기 한 곳에서 다시 거른다(이중 방어). 필터는 풀을 좁힐 뿐 넓히지 않는다(INV-1). 미매핑 컨셉(자유 문자열·
        // 구버전 앱)은 400 이 아니라 필터 없음 + 로그 1줄(reason 선례).
        val conceptSet = ConceptCategories.of(request.concept)
        if (conceptSet == null) {
            if (!request.concept.isNullOrBlank()) {
                log.info("매핑에 없는 컨셉 — 필터 없이 응답합니다. concept={} tripId={}", request.concept, tripId)
            }
            // 0건 1회 확장(TRIP-1311 · BR-U3-25) — "주변에 없다"면 사용자 손을 기다리지 않고 한 단계 넓혀
            // 풀을 직접 본다. ALL_IN_ITINERARY 는 넓혀도 같은 결과라 넓히지 않는다.
            if (kept.isEmpty() && answered.emptyReason == SlotCandidatesEmptyReason.NO_NEARBY) {
                return poolRefill(null, emptySet(), center, inItinerary, targetPoiId, answered)
            }
            return answered.copy(candidates = kept)
        }
        val matched = kept.filter { groundedById.getValue(it.poiId).category in conceptSet }
        if (matched.isNotEmpty()) return answered.copy(candidates = matched)

        // 경계가 컨셉 밖 후보만 줬다(예: LLM 빈 결과 → 규칙 폴백이 카테고리를 모름). 컨셉 카테고리로
        // 풀을 직접 봐서 채운다 — 반경 안에 맛집이 실재하는데 "주변에 없음"이라 말하면 거짓이다.
        return poolRefill(request.concept, conceptSet, center, inItinerary, targetPoiId, answered)
    }

    /**
     * 그 슬롯의 시각에 실제로 들어가는 후보만 남긴다. 세 갈래 모두 **슬롯 시각을 모른 채** 고르는데, 사용자가 고르면
     * 편집 저장([EditItineraryService])이 repair 로 시각을 맞춰 보고 못 맞추면 위반 표시로 저장한다 — 로컬 재현
     * (부산 2일, 28회 교체)에서 3건이 "영업시간과 맞지 않아요"(HC1)로 저장됐다. 그 판정을 고르기 전에 미리 한다.
     *
     * 판정 = 대상 슬롯의 장소만 후보로 바꾼 **그 날**(시각·고정·자정 넘김·그날 다른 슬롯은 그대로)이 수리 불가가 아닌가.
     * 저장 경로와 같은 변환([toOutput])·같은 질문(repair)·같은 컨텍스트라 두 판정이 어긋나지 않는다 — 컨텍스트를
     * 빼면 상대가 대중교통·앵커 없음으로 재서, 렌터카 여행이나 첫 칸 교체(저장은 앵커 출발만큼 민다)에서 저장과 다른 답이 된다.
     * **그 날만 보낸다.** 상대 repair 는 일정 **전체**가 수리되는지를 답하고(HC1~4 는 날 안에서 판정·수리 루프는 날마다
     * 새로 시작), 하루 창이 23:59 에 끝나 자정 넘김 칸 하나만 있어도 전체가 수리 불가다 — 다른 날을 같이 보내면 그 날의
     * 무관한 칸 때문에 모든 후보가 부적합으로 나와 필터가 꺼진다. 그 날만 보내면 대상 날의 답은 같고, 상대가 수리 성공마다
     * 재는 구간 거리(외부 경로 API)도 그 날 것으로 준다.
     * - 판정이 예외면 그 후보와 **남은 후보 전부**를 판정 없이 남긴다 — 판정 못 함 ≠ 부적합. 상대 불통은 후보마다
     *   다르지 않아, 계속 부르면 후보 수만큼 읽기 상한(편집 대기 60s)을 다시 기다린다(즉답 갈래는 원래 AI 호출 0회다).
     * - 전부 부적합이면 원래 목록 그대로 — 0건으로 접으면 "주변에 없음" 같은 거짓 사유가 되고 지금보다 나빠진다.
     *   그 날의 다른 칸이 이미 수리 불가면(위반 표시로 저장된 칸) 후보와 무관하게 이 갈래로 온다.
     * 후보는 이미 상한으로 작아 순차로 부른다.
     */
    private fun keepFitting(
        out: SlotCandidatesOutput,
        itinerary: Itinerary,
        date: LocalDate,
        index: Int,
        accountId: UUID,
        tripId: UUID,
        slotKey: String,
        /** 남길 최대 개수 — 앞에서부터 이만큼 맞으면 나머지는 판정하지 않는다(판정 1회 = AI repair 1회). */
        limit: Int,
    ): SlotCandidatesOutput {
        if (out.candidates.isEmpty()) return out
        // 저장 경로(attemptRepair)와 같은 규칙 — 앵커는 첫 구간이 바뀐 날만 싣고, 장소 하나 교체에서 그런 날은 첫 칸 교체의 그날뿐이다.
        val context = runCatching { repairContexts.of(accountId, tripId, if (index == 0) setOf(date) else emptySet()) }.getOrElse { e ->
            log.warn("슬롯 후보 적합 판정 컨텍스트(앵커·수단) 조회 실패 — 컨텍스트 없이 판정합니다. tripId={}", tripId, e)
            RepairContext.NONE
        }
        val current = EditItinerary(
            itinerary.days.filter { it.date == date }
                .map { d -> EditDay(d.date, d.slots.map { EditSlot(it.sourcePoiId, it.startAt, it.endAt, it.isFixed, it.endsNextDay) }) },
        )
        var unjudged = false
        var misfit = 0
        val fit = mutableListOf<SlotCandidate>()
        for (c in out.candidates) {
            if (fit.size == limit) break
            if (unjudged) {
                fit += c
                continue
            }
            val swapped = current.copy(
                days = current.days.map { d -> d.copy(slots = d.slots.mapIndexed { i, s -> if (i == index) s.copy(poiId = c.poiId) else s }) },
            )
            val fits = try {
                !scheduleAgent.repair(swapped.toOutput(itinerary.solveMode, itinerary.isFallback, clock.instant()), emptyList(), context).unrepairable
            } catch (e: Exception) {
                log.warn("슬롯 후보 적합 판정(repair) 실패 — 이 후보부터 판정 없이 남깁니다. tripId={} slotKey={} poiId={}", tripId, slotKey, c.poiId, e)
                unjudged = true
                true
            }
            if (fits) fit += c else misfit++
        }
        if (fit.isEmpty()) {
            log.warn("슬롯 후보 {}건이 전부 그 슬롯 시각에 맞지 않습니다 — 원래 목록을 그대로 줍니다. tripId={} slotKey={}", out.candidates.size, tripId, slotKey)
            return out.copy(candidates = out.candidates.take(limit))
        }
        if (misfit > 0) {
            log.info("슬롯 시각에 맞지 않는 후보 {}건을 뺐습니다. tripId={} slotKey={}", misfit, tripId, slotKey)
        }
        return out.copy(candidates = fit)
    }

    /**
     * 풀 직접 채움 — closed-set 풀([CandidatePoolPort]) 그대로, 거리순. 컨셉 카테고리(TRIP-1065)이거나,
     * 컨셉이 없으면 전 카테고리([categories] 빈 집합 — TRIP-1311 0건 확장).
     * AI 순위가 아니므로 **degraded=true 로 정직하게** 표시한다(INV-4). 0건이면 로컬 폴백과 같은
     * 규약으로 사유를 가른다(BR-U3-25): 반경을 한 번 넓혀 보고, 그래도 없으면 NO_NEARBY,
     * 있는데 전부 일정에 들어 있으면 ALL_IN_ITINERARY. 넓히기는 **한 번뿐**이다 — 더 넓히면 엉뚱한 동네다.
     */
    private fun poolRefill(
        concept: String?,
        categories: Set<String>,
        center: RegionCenter,
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
        if (found.isEmpty() && radius < WIDENED_RADIUS_M) {
            radius = WIDENED_RADIUS_M
            nearby = search(radius)
            found = nearby.filterNot { it.poiId in excluded }
        }
        return base.copy(
            candidates = found.take(MAX_STORED_CANDIDATES).map { it.toSlotCandidate(concept) },
            radiusMUsed = radius,
            freshness = FreshnessMeta(clock.instant(), degraded = true),
            emptyReason = when {
                found.isNotEmpty() -> null
                nearby.isEmpty() -> SlotCandidatesEmptyReason.NO_NEARBY
                else -> SlotCandidatesEmptyReason.ALL_IN_ITINERARY
            },
        )
    }

    /** 풀에서 바로 꺼낸 후보. */
    private fun GroundedPlace.toSlotCandidate(concept: String?) = SlotCandidate(
        poiId = poiId,
        // 거리만 — 소요시간은 어떤 이유로도 내보내지 않는다(INV-3).
        distanceRange = distanceM?.let { m -> "약 ${"%.1f".format(Locale.ROOT, m / 1000)}km" } ?: "거리 미확인",
        // 필터를 통과한 카테고리라 이 문구는 참이다(BR-U2-09 — 시각·소요시간 언급 없음).
        rationale = concept?.let { c -> "$c 컨셉에 맞는 $category" } ?: "주변 $category",
    )

    /**
     * 구 안 우선(2026-10-23 사용자 결정 "구 안 우선, 모자라면 이웃 구") — 서초를 고른 여행의 같이 짜기에서 점심은 서초,
     * 저녁은 혜화로 튀었다(직전 장소 중심 + 넓힌 반경이 구 경계를 모른다). 어느 갈래의 결과든 **같은 반경 안에서**
     * 구 안 후보 → 그 반경의 구 안 장소(거리순, 구 밖 개수만큼) → 구 밖 후보 순으로 **덧붙여** 돌려준다. 개수는 호출측이
     * 적합 판정 뒤에 원래대로 자른다 — 구 안이 모자라거나 시각에 안 맞을 때만 구 밖이 남는다.
     * 바꿔 넣은 것은 AI 순위가 아니라 거리순이라 degraded 로 표시한다(INV-4).
     * ponytail: "이웃 구"는 행정 인접이 아니라 "구 밖이지만 요청 반경 안" — 인접 표가 생기면 그걸로 좁힌다.
     */
    private fun inDistrictFirst(
        out: SlotCandidatesOutput,
        districtCodes: Set<String>,
        center: RegionCenter,
        concept: String?,
        inItinerary: List<UUID>,
        targetPoiId: UUID,
    ): SlotCandidatesOutput {
        if (districtCodes.isEmpty()) return out
        fun inDistrict(code: String?) = code != null && code in districtCodes
        val grounded = candidatePool.ground(out.candidates.map { it.poiId } + targetPoiId).associateBy { it.poiId }
        val (inside, outside) = out.candidates.partition { inDistrict(grounded[it.poiId]?.regionCode) }
        if (outside.isEmpty()) return out
        // 컨셉이 없으면 교체 대상과 같은 카테고리 — 점심 자리에 명소가 끼지 않게(즉답의 "같은 카테고리 예비"와 같은 판단).
        // 교체 대상이 비활성(폐업 — 바로 그래서 바꾸는 중일 수 있다)이면 카테고리를 몰라 채우지 않고 순서만 바꾼다.
        val conceptSet = ConceptCategories.of(concept)
        val categories = conceptSet ?: grounded[targetPoiId]?.let { setOf(it.category) } ?: return out.copy(candidates = inside + outside)
        val taken = inside.map { it.poiId }.toSet() + inItinerary + targetPoiId
        val refill = candidatePool
            .resolve(Area.Radius(center.lat, center.lng, out.radiusMUsed.toDouble()), categories)
            .filter { inDistrict(it.regionCode) && it.poiId !in taken }
            .sortedBy { it.distanceM ?: Double.MAX_VALUE }
            .take(outside.size)
            .map { it.toSlotCandidate(concept.takeIf { conceptSet != null }) } // 매핑 없는 컨셉으로 고른 게 아니다 — 문구에 싣지 않는다(BR-U2-09)
        if (refill.isEmpty()) return out.copy(candidates = inside + outside)
        return out.copy(
            candidates = inside + refill + outside,
            freshness = FreshnessMeta(clock.instant(), degraded = true),
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
        center: RegionCenter,
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


    /**
     * 느린 경로(AI 왕복)에만 취향을 싣는다 — 즉답은 생성 때 이미 그 취향으로 매긴 점수라 다시 물을 게 없다.
     * 매핑은 생성과 **같은 함수**(`overriddenBy` → `toProfile`)다 — 후보가 생성과 다른 취향으로 고르면
     * "일정은 미식인데 다른 후보는 액티비티"가 된다.
     */
    private fun SlotCandidatesInput.withTripPreference(accountId: UUID, tripId: UUID): SlotCandidatesInput {
        val ctx = trips.findGenerationContext(accountId, tripId) ?: return this
        val profile = preferences.findPreferences(accountId).overriddenBy(ctx.preferenceSnapshot)
            .toProfile(personalization.hintsFor(accountId), ctx.preferenceSnapshot.keys)
        return copy(preferenceProfile = profile, companionType = ctx.companionType)
    }
    companion object {
        private val TRAVEL_ZONE: ZoneId = ZoneId.of("Asia/Seoul")

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

        /** 풀 채움의 넓힌 반경(컨셉 채움·0건 확장) — 로컬 폴백(h15 "반경 넓힘")과 같은 값. */
        private const val WIDENED_RADIUS_M = 12_000
    }
}
