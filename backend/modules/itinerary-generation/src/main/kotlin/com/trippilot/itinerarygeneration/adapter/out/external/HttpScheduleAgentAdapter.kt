package com.trippilot.itinerarygeneration.adapter.out.external

import com.trippilot.itinerarygeneration.domain.RepairResult
import com.trippilot.itinerarygeneration.domain.ScheduleAgentCallFailed
import com.trippilot.itinerarygeneration.domain.ScheduleAgentInput
import com.trippilot.itinerarygeneration.domain.ScheduleAgentOutput
import com.trippilot.itinerarygeneration.domain.ScheduleAgentPort
import com.trippilot.itinerarygeneration.domain.Violation
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty
import org.springframework.context.annotation.Primary
import org.springframework.stereotype.Component
import org.springframework.web.client.RestClient
import java.time.Clock

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
        val wire = try {
            scheduleAgentRestClient.post()
                .uri(GENERATE_PATH)
                .body(input)
                .retrieve()
                .onStatus({ it.isError }) { _, response ->
                    throw callFailed(response.statusCode.value(), response.body.readNBytes(MAX_ERROR_BODY_BYTES))
                }
                .body(AiScheduleResponse::class.java)
                ?: throw ScheduleAgentCallFailed(null, retryable = false, message = "AI 응답 본문이 비었습니다.")
        } catch (e: ScheduleAgentCallFailed) {
            throw e // 상태코드 판정 그대로 전달
        } catch (e: Exception) {
            // 네트워크 단절·read-timeout·역직렬화 실패 — "유효한 200 을 받지 못한 경우"(폴백 대상).
            throw ScheduleAgentCallFailed(null, retryable = true, message = "AI 호출 실패: ${e.message}", cause = e)
        }
        return try {
            wire.toDomain(clock.instant())
        } catch (e: IllegalArgumentException) {
            // 스키마 드리프트(미지 solve_mode 등) — 침묵 금지(INV-4), 폴백 신호로 승격.
            throw ScheduleAgentCallFailed(null, retryable = false, message = "AI 응답 스키마 불일치: ${e.message}", cause = e)
        }
    }

    /**
     * 실 호출 미구현 — AI 측 `validate` 요청/응답 스키마가 미확정(TRIP-282 N6)이고, Violation 표현도
     * AI `(code, slot_ref)` ↔ 백엔드 `(type, dayIndex, slotIndex)` 로 어긋나 있다.
     * **빈 목록을 반환하지 않는다** — "위반 없음"으로 보이는 거짓 음성이 확정까지 흘러가는 것보다 실패가 안전하다.
     */
    override fun validate(solution: ScheduleAgentOutput): List<Violation> =
        throw ScheduleAgentCallFailed(
            "VALIDATE_NOT_WIRED", retryable = false,
            message = "AI validate 경계 미배선(TRIP-282 스키마 확정 대기) — http 모드에서 편집 재검증 불가.",
        )

    /** 실 호출 미구현 — [validate] 와 동일 사유. */
    override fun repair(solution: ScheduleAgentOutput, violations: List<Violation>): RepairResult =
        throw ScheduleAgentCallFailed(
            "REPAIR_NOT_WIRED", retryable = false,
            message = "AI repair 경계 미배선(TRIP-282 스키마 확정 대기).",
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
        private const val MAX_ERROR_BODY_BYTES = 8 * 1024 // 오류 페이지가 커도 힙을 물지 않게 상한
        private val ERROR_MAPPER = ScheduleAgentConfiguration.boundaryMapper()
    }
}

/** AI 에러 응답 바디(계약 PR #104). snake_case 매퍼가 error_code→errorCode 매핑. */
internal data class AiErrorBody(
    val errorCode: String? = null,
    val message: String? = null,
    val retryable: Boolean = false,
)
