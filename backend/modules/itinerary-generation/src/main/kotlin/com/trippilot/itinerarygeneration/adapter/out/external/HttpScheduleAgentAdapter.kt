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
import com.trippilot.itinerarygeneration.domain.Violation
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty
import org.springframework.context.annotation.Primary
import org.springframework.stereotype.Component
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
    private fun <T : Any> post(path: String, body: Any, type: Class<T>): T = try {
        scheduleAgentRestClient.post()
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

    private fun requestMeta(deadlineMs: Long) =
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
        ).violations.map { it.toDomain() }

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
     * 미개통 — AI 에 아직 슬롯 후보 경로가 없다(generate·validate·repair 3종만 열려 있음).
     * **빈 목록을 돌려주지 않는다**: "주변에 후보가 없다"는 정상 결과와 구분되지 않아 사용자가 반경을
     * 넓혀도 계속 0건인 이유를 알 수 없게 된다(INV-4 침묵 금지).
     */
    override fun proposeSlotCandidates(input: SlotCandidatesInput): SlotCandidatesOutput =
        throw ScheduleAgentCallFailed(
            "SLOT_CANDIDATES_NOT_WIRED", retryable = false,
            message = "AI 슬롯 후보 경계 미개통 — http 모드에서 후보 제안 불가(DEC-U3-5).",
        )

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
        private const val GENERATE_PATH = "/ai/v1/itinerary/generate"
        private const val VALIDATE_PATH = "/ai/v1/itinerary/validate"
        private const val REPAIR_PATH = "/ai/v1/itinerary/repair"

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
