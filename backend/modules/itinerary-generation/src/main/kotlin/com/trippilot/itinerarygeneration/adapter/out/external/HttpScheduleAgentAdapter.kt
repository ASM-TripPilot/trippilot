package com.trippilot.itinerarygeneration.adapter.out.external

import com.trippilot.itinerarygeneration.domain.RepairResult
import com.trippilot.itinerarygeneration.domain.ScheduleAgentCallFailed
import com.trippilot.itinerarygeneration.domain.DayAnchor
import com.trippilot.itinerarygeneration.domain.FixedBlock
import com.trippilot.itinerarygeneration.domain.GenerationMode
import com.trippilot.itinerarygeneration.domain.PreferenceProfile
import com.trippilot.itinerarygeneration.domain.ReplanInput
import com.trippilot.itinerarygeneration.domain.ScheduleAgentInput
import com.trippilot.itinerarygeneration.domain.TimeWindow
import com.trippilot.itinerarygeneration.domain.TripContext
import com.trippilot.itinerarygeneration.domain.ScheduleAgentOutput
import com.trippilot.itinerarygeneration.domain.SlotCandidatesInput
import com.trippilot.itinerarygeneration.domain.SlotCandidatesOutput
import com.trippilot.itinerarygeneration.domain.ScheduleAgentPort
import com.trippilot.placedata.api.CandidatePoolPort
import com.trippilot.itinerarygeneration.domain.Violation
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty
import org.springframework.context.annotation.Primary
import org.springframework.stereotype.Component
import org.slf4j.LoggerFactory
import org.springframework.web.client.RestClient
import java.time.Clock
import java.util.UUID

/**
 * 실 AI 서비스(U5) HTTP 어댑터 — 포워드 경계(TRIP-229). `POST {baseUrl}/ai/v1/itinerary/generate`.
 *
 * **대원칙(PR #104): AI 가 200 을 반환하면 그대로 사용한다** — `is_fallback=true` 여도 예외를 던지지 않는다
 * (AI 가 이미 폴백을 마친 결과물이지 실패 신호가 아니다). 4xx/5xx·네트워크 실패·응답 스키마 불일치만
 * [ScheduleAgentCallFailed] 로 올려 백엔드 결정론 폴백(INV-4)을 발동시킨다. **재시도는 하지 않는다**
 * (AI 실패는 결정론이라 재시도 이득이 없고 사용자 대기시간만 2배 — 백엔드 선언 정책).
 *
 * 응답은 [AiScheduleResponse] 와이어 타입으로 받아 어댑터가 도메인으로 매핑한다(AI 실 스키마 흡수).
 */
@Component
@Primary
@ConditionalOnProperty(name = ["trippilot.ai.schedule.mode"], havingValue = "http")
class HttpScheduleAgentAdapter(
    private val scheduleAgentRestClient: RestClient,
    /** 편집 경로 전용 — 생성만큼 오래 기다리지 않는다(설정 주석 참고). */
    private val scheduleAgentBoundedRestClient: RestClient,
    private val localCandidates: LocalSlotCandidateSource,
    /** 슬롯 후보의 INV-1 게이트 + 거리 계산 좌표(D-5가) — AI 응답에 거리 필드가 없어 우리가 채운다. */
    private val candidatePool: CandidatePoolPort,
    private val clock: Clock,
) : ScheduleAgentPort {

    override fun generate(input: ScheduleAgentInput): ScheduleAgentOutput {
        val wire = post(GENERATE_PATH, input, AiScheduleResponse::class.java)
        return try {
            wire.toDomain(clock.instant())
        } catch (e: IllegalArgumentException) {
            // 스키마 드리프트(미지 solve_mode 등) — 침묵 금지(INV-4), 폴백 신호로 승격.
            throw ScheduleAgentCallFailed(null, retryable = false, message = "AI 응답 스키마 불일치: ${e.message}", cause = e)
        }
    }

    /**
     * 경계 POST 공통 — 오류 상태는 도메인 실패로, 네트워크·역직렬화 실패는 재시도 가능 실패로 번역한다.
     * **재시도는 하지 않는다**(호출자가 폴백을 결정한다).
     */
    private fun <T : Any> post(
        path: String,
        body: Any,
        type: Class<T>,
        client: RestClient = scheduleAgentRestClient,
    ): T = try {
        client.post()
            .uri(path)
            .body(body)
            .retrieve()
            .onStatus({ it.isError }) { _, response ->
                throw callFailed(response.statusCode.value(), response.body.readNBytes(MAX_ERROR_BODY_BYTES))
            }
            .body(type)
            ?: throw ScheduleAgentCallFailed(null, retryable = false, message = "AI 응답 본문이 비었습니다.")
    } catch (e: ScheduleAgentCallFailed) {
        throw e // 상태코드 판정 그대로 전달
    } catch (e: Exception) {
        // 네트워크 단절·read-timeout·역직렬화 실패 — "유효한 200 을 받지 못한 경우"(폴백 대상).
        throw ScheduleAgentCallFailed(null, retryable = true, message = "AI 호출 실패: ${e.message}", cause = e)
    }

    private fun requestMeta(deadlineMs: Long?) =
        AiRequestMeta(UUID.randomUUID().toString(), clock.instant(), deadlineMs)

    /**
     * 편집 재검증(HC1-4). 위반은 **정상 응답 200**이고 빈 목록 = 위반 없음이다(IO-7).
     * 산출물 전체를 되돌려 보낸다 — 슬롯만 보내면 상대가 날짜 맥락을 잃어 위치 인덱스를 계산할 수 없다.
     */
    override fun validate(solution: ScheduleAgentOutput): List<Violation> =
        post(
            VALIDATE_PATH,
            AiValidateRequest(solution.toWire(), requestMeta(VALIDATE_DEADLINE_MS)),
            AiValidateResponse::class.java,
            scheduleAgentBoundedRestClient,
        ).violations.map { it.toDomain() }

    /**
     * 추천 근거 조회(TRIP-511). 편집 경로와 같은 **짧게 끊는 클라이언트**를 쓴다 —
     * 생성용 상한(시간제약 해제 시 612초)은 배경 작업이라도 과하다.
     *
     * **실패를 삼킨다.** 근거가 없다고 일정을 죽이면 사용자가 잃는 것이 더 크다. 대신 조용히
     * 지나가지 않게 로그로 남긴다(INV-4) — 근거가 통째로 비는 화면은 눈에 띄지만 원인은 안 보인다.
     */
    override fun explanations(tripId: UUID, solution: ScheduleAgentOutput): Map<String, String> =
        runCatching {
            post(
                EXPLANATIONS_PATH,
                AiExplanationsRequest(tripId.toString(), solution.toWire(), requestMeta(null)),
                AiExplanationsResponse::class.java,
                scheduleAgentBoundedRestClient,
            )
        }.onFailure {
            log.warn("추천 근거 조회 실패 — 근거 없이 일정을 마칩니다. tripId={}", tripId, it)
        }.getOrNull()?.let { res ->
            if (res.isFallback) {
                log.info("추천 근거가 폴백입니다 — reason={} tripId={}", res.reason, tripId)
            }
            res.explanations
        } ?: emptyMap()

    /**
     * 최소 조정 수리 — 시각·순서만 바꾸고 POI 는 불변이다(BR-U3-14).
     * **수리 불가는 오류가 아니라 `repaired=null`** 이므로(IO-7) 원본을 그대로 돌려주고 변경 없음으로 표시한다.
     */
    override fun repair(solution: ScheduleAgentOutput, violations: List<Violation>): RepairResult {
        val response = post(
            REPAIR_PATH,
            AiRepairRequest(
                solution.toWire(),
                // slotRef 를 되돌려 보낸다 — 인덱스만 보내면 검증 시점과 수리 대상이 어긋났을 때 상대가 복구할 수단이 없다.
                violations.map { AiViolation(it.type, it.slotRef, it.detail.orEmpty(), it.dayIndex, it.slotIndex) },
                requestMeta(REPAIR_DEADLINE_MS),
            ),
            AiRepairResponse::class.java,
            scheduleAgentBoundedRestClient,
        )
        val repaired = response.repaired ?: return RepairResult(solution, emptyList())
        return try {
            RepairResult(repaired.toDomain(clock.instant()), response.changes)
        } catch (e: IllegalArgumentException) {
            throw ScheduleAgentCallFailed(null, retryable = false, message = "AI 수리 응답 스키마 불일치: ${e.message}", cause = e)
        }
    }

    /**
     * 재계획(정본 §3.1) — **상대에 새 경로를 요구하지 않는다.** 잠금 슬롯을 고정 블록으로 승격해
     * 이미 열려 있는 `generate` 를 그대로 쓴다(HC3 가 그 시각을 지킨다).
     *
     * ⚠ `reasons`·`directives`·`freeText` 는 **보내지 않는다** — 상대 요청 계약
     * (`ai/docs/openapi.json` `GenerateItineraryRequest`)에 실을 자리가 없다. 없는 필드를 지어내면
     * 422 로 전 호출이 폴백된다(그 드리프트는 `AiBoundaryOpenApiTest` 가 막는다). 사용자가 고른 '왜·어떻게'는
     * 세션에 남아 이력이 되지만 **이번 산출에는 반영되지 않는다** — 반영하려면 AI 쪽 요청 계약에 필드가 먼저 생겨야 한다.
     */
    override fun replan(input: ReplanInput): ScheduleAgentOutput {
        val generateInput = ScheduleAgentInput(
            tripId = input.tripId,
            generationMode = GenerationMode.FULLY_AI,
            tripContext = TripContext(input.destinations, input.targetDate, input.targetDate, null, null),
            // 상대는 후보 풀을 좌표에 매단다 — 앵커가 없으면 422 다(실측). 재계획의 기준점은 **현재 위치**이고,
            // 없으면 호출측이 숙소 앵커로 채워 준다(BR-U4-19 사다리).
            anchors = listOfNotNull(
                input.originLat?.let { lat -> input.originLng?.let { lng -> DayAnchor(input.targetDate, lat, lng) } },
            ),
            // 창은 **하루 전체**다. '지금 이후만' 은 창을 좁혀서가 아니라 **잠금**으로 표현한다(정본 §3.1) —
            // 창을 지금부터로 좁히면 오전에 잠긴 고정 블록이 창 밖이 되어 상대가 모순으로 거부한다(실측 409).
            timeWindows = listOf(TimeWindow(input.targetDate, DAY_START, DAY_END)),
            fixedBlocks = input.lockedBlocks,
            preferenceProfile = NEUTRAL_PREFERENCES,
            recommendationStrength = null,
            requestMeta = input.requestMeta,
            excludedPoiIds = input.excludedPoiIds,
        )
        val wire = post(GENERATE_PATH, generateInput, AiScheduleResponse::class.java)
        return try {
            wire.toDomain(clock.instant())
        } catch (e: IllegalArgumentException) {
            throw ScheduleAgentCallFailed(null, retryable = false, message = "AI 재계획 응답 스키마 불일치: ${e.message}", cause = e)
        }
    }

    /**
     * 슬롯 후보 — `POST /ai/v1/itinerary/alternatives` 실호출(TRIP-463 · 연동 설계 정본:
     * `backend/docs/design/ai-backend-alternatives-연동-설계.md`).
     *
     * AI 가 더하는 것은 **순위와 이유**다(집합의 주인은 C7·INV-1). 응답에 없는 값 — 거리·반경·시각 —
     * 은 [toDomain] 이 백엔드 데이터로 채운다. `degraded` 는 이제 리터럴이 아니라
     * **`fallback_level >= 1`**(AI 가 LLM 랭킹을 못 냈을 때만 true)이다.
     *
     * AI 미도달이면 로컬 후보풀로 폴백한다(D-4가) — 오늘까지의 http 모드 동작과 같아 가용성 회귀가 0 이다.
     * **재시도 없음**(선언 정책). 사용자가 화면에서 기다리는 동작이라 bounded 클라이언트를 쓴다.
     */
    override fun proposeSlotCandidates(input: SlotCandidatesInput): SlotCandidatesOutput = try {
        val res = post(ALTERNATIVES_PATH, input.toAlternativesRequest(), AiAlternativesResponse::class.java, scheduleAgentBoundedRestClient)
        // 진단값은 로그로만 — 사용자 문구가 아니다(설계 §3). dropped 는 우리 ground() 탈락과 나란히
        // 봐야 INV-1 경로 전체가 보이므로 WARN 으로 올린다.
        if (res.notes.isNotEmpty()) log.info("alternatives notes: {}", res.notes)
        if (res.droppedOutOfPool.isNotEmpty()) log.warn("AI 가 자기 풀 기준으로 버린 참조: {}", res.droppedOutOfPool)
        if (res.emptyReason != null && res.emptyReason != "no_candidates" && res.emptyReason != "all_excluded") {
            log.warn("모르는 empty_reason '{}' — NO_NEARBY 로 떨어뜨립니다.", res.emptyReason)
        }
        val ids = res.alternatives.flatMap { it.poiIds }.mapNotNull { raw -> runCatching { UUID.fromString(raw) }.getOrNull() }
        // INV-1 게이트 — 상대가 뭐라 답했든 실재 확인(ACTIVE)된 것만 후보가 된다.
        val grounded = if (ids.isEmpty()) emptyList() else candidatePool.ground(ids)
        if (grounded.size < ids.size) log.warn("ground() 탈락 {}건 — AI 응답 {}건 중", ids.size - grounded.size, ids.size)
        res.toDomain(input, grounded, clock.instant())
    } catch (e: ScheduleAgentCallFailed) {
        // D-4(가): 미도달은 로컬 폴백 — 조용히 넘어가지 않는다(INV-4).
        log.warn("AI alternatives 미도달 — 로컬 후보풀로 폴백합니다: {}", e.message)
        localCandidates.propose(input, degraded = true)
    }

    /** 에러 응답 → 도메인 실패. 바디 `{error_code, message, retryable}`(계약) 파싱 실패해도 상태코드로 판정. */
    private fun callFailed(status: Int, body: ByteArray): ScheduleAgentCallFailed {
        val parsed = runCatching { ERROR_MAPPER.readValue(body, AiErrorBody::class.java) }.getOrNull()
        return ScheduleAgentCallFailed(
            errorCode = parsed?.errorCode,
            retryable = parsed?.retryable ?: false, // 계약: AI 오류는 대부분 재시도해도 동일
            message = "AI 오류 $status: ${parsed?.message ?: "본문 없음"}",
        )
    }

    companion object {
        private val log = LoggerFactory.getLogger(HttpScheduleAgentAdapter::class.java)

        internal const val GENERATE_PATH = "/ai/v1/itinerary/generate"
        internal const val VALIDATE_PATH = "/ai/v1/itinerary/validate"
        internal const val REPAIR_PATH = "/ai/v1/itinerary/repair"
        internal const val EXPLANATIONS_PATH = "/ai/v1/itinerary/explanations"
        internal const val ALTERNATIVES_PATH = "/ai/v1/itinerary/alternatives"

        /**
         * **이 목록이 계약 게이트의 입력이다.** 손으로 관리하는 목록을 테스트가 따로 또 들고 있으면
         * 둘이 갈라진다 — 실제로 그래서 explanations 가 게이트 밖에 있었다(2026-09-01). 경로를
         * 하나 늘리면 여기에 넣게 되고, 그러면 게이트가 저절로 따라온다.
         */
        internal val CALLED_PATHS = listOf(GENERATE_PATH, VALIDATE_PATH, REPAIR_PATH, EXPLANATIONS_PATH, ALTERNATIVES_PATH)

        // 편집 재검증·보정은 사용자가 화면에서 기다리는 동작이라 생성(20s)보다 짧게 잡는다.
        private const val VALIDATE_DEADLINE_MS = 3_000L
        private const val REPAIR_DEADLINE_MS = 5_000L
        private const val MAX_ERROR_BODY_BYTES = 8 * 1024 // 오류 페이지가 커도 힙을 물지 않게 상한
        private val ERROR_MAPPER = ScheduleAgentConfiguration.boundaryMapper()

        private val DAY_START: java.time.LocalTime = java.time.LocalTime.of(9, 0)
        private val DAY_END: java.time.LocalTime = java.time.LocalTime.of(21, 0)

        /**
         * 재계획은 **취향을 다시 묻지 않는다** — 중립 프로필로 보낸다.
         * 여행 중 재계획의 입력은 '왜·어떻게'인데 그건 아직 경계에 실을 자리가 없고(위 주석),
         * 계정 취향을 여기서 다시 조회하면 재계획 모듈이 profile 에 의존하게 된다(R1 확대).
         */
        private val NEUTRAL_PREFERENCES = PreferenceProfile(
            emptyList(), emptyList(), emptyList(), emptyList(), null, emptyList(), false, null,
        )
    }
}

/** AI 에러 응답 바디(계약 PR #104). snake_case 매퍼가 error_code→errorCode 매핑. */
internal data class AiErrorBody(
    val errorCode: String? = null,
    val message: String? = null,
    val retryable: Boolean = false,
)
