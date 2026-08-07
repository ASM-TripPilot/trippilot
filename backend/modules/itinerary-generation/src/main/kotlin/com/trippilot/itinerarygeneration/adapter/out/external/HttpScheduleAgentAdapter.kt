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
import tools.jackson.databind.ObjectMapper

/**
 * 실 AI 서비스(U5) HTTP 어댑터 — 포워드 경계(TRIP-229). `POST {baseUrl}/ai/v1/itinerary/generate`.
 *
 * **대원칙(PR #104): AI 가 200 을 반환하면 그대로 사용한다** — `is_fallback=true` 여도 예외를 던지지 않는다
 * (그건 AI 가 이미 폴백을 마친 결과물이지 실패 신호가 아니다). 4xx/5xx·네트워크 실패만
 * [ScheduleAgentCallFailed] 로 올려 백엔드 결정론 폴백(INV-4)을 발동시킨다. **재시도는 하지 않는다**
 * (AI 실패는 결정론이라 재시도 이득이 없고 사용자 대기시간만 2배가 됨 — 백엔드 선언 정책).
 *
 * `validate`/`repair` 는 **AI 측 계약 미확정**(공개 메서드 승격·deadline 인지·Violation 스키마 통일 = TRIP-292)이라
 * 여기서 호출하지 않고 [FakeScheduleAgent] 에 위임한다 — http 모드에서도 편집 재검증 흐름이 끊기지 않게.
 * 292 확정 시 이 위임을 실 호출로 대체한다.
 */
@Component
@Primary
@ConditionalOnProperty(name = ["trippilot.ai.schedule.mode"], havingValue = "http")
class HttpScheduleAgentAdapter(
    private val scheduleAgentRestClient: RestClient,
    private val scheduleAgentErrorMapper: ObjectMapper,
    private val fakeForUnimplemented: FakeScheduleAgent, // validate/repair 임시 위임(TRIP-292 까지)
) : ScheduleAgentPort {

    override fun generate(input: ScheduleAgentInput): ScheduleAgentOutput =
        try {
            scheduleAgentRestClient.post()
                .uri(GENERATE_PATH)
                .body(input)
                .retrieve()
                .onStatus({ it.isError }) { _, response ->
                    throw callFailed(response.statusCode.value(), response.body.readBytes())
                }
                .body(ScheduleAgentOutput::class.java)
                ?: throw ScheduleAgentCallFailed(null, retryable = false, message = "AI 응답 본문이 비었습니다.")
        } catch (e: ScheduleAgentCallFailed) {
            throw e // 상태코드 판정은 그대로 전달
        } catch (e: Exception) {
            // 네트워크 단절·read-timeout·역직렬화 실패 — "유효한 200 을 받지 못한 경우"(폴백 대상).
            throw ScheduleAgentCallFailed(null, retryable = true, message = "AI 호출 실패: ${e.message}", cause = e)
        }

    /** TRIP-292(공개 메서드 승격·스키마 확정) 전까지 Fake 위임. */
    override fun validate(solution: ScheduleAgentOutput): List<Violation> = fakeForUnimplemented.validate(solution)

    /** TRIP-292 전까지 Fake 위임. */
    override fun repair(solution: ScheduleAgentOutput, violations: List<Violation>): RepairResult =
        fakeForUnimplemented.repair(solution, violations)

    /** 에러 응답 → 도메인 실패. 바디 `{error_code, message, retryable}`(계약) 파싱 실패해도 상태코드로 판정. */
    private fun callFailed(status: Int, body: ByteArray): ScheduleAgentCallFailed {
        val parsed = runCatching { scheduleAgentErrorMapper.readValue(body, AiErrorBody::class.java) }.getOrNull()
        return ScheduleAgentCallFailed(
            errorCode = parsed?.errorCode,
            retryable = parsed?.retryable ?: false, // 계약: AI 오류는 대부분 재시도해도 동일(retryable=false)
            message = "AI 오류 $status: ${parsed?.message ?: "본문 없음"}",
        )
    }

    companion object {
        private const val GENERATE_PATH = "/ai/v1/itinerary/generate"
    }
}

/** AI 에러 응답 바디(계약 PR #104). snake_case 매퍼가 error_code→errorCode 매핑. */
internal data class AiErrorBody(
    val errorCode: String? = null,
    val message: String? = null,
    val retryable: Boolean = false,
)
