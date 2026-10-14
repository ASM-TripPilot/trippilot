package com.trippilot.assistant.application

import org.springframework.boot.context.properties.ConfigurationProperties
import java.time.Duration

/**
 * 도우미 설정(tech-stack §2 델타 4). 정본은 키를 `assistant.*` 로 적었지만 이 리포의 설정은 전부
 * `trippilot.*` 아래라 그 관례를 따른다. **지금 읽히는 키만 둔다** — 전역 월 상한·스냅샷 상한은 그 값을 읽는 코드와
 * 함께 들어온다.
 *
 * @property retentionDays 대화 보존 = 마지막 턴 후 이만큼(DATA-U8-01). **잠정값** — 처리방침이 정해지면 여기만 바꾼다.
 * @property turnBudgetMs 서버가 한 턴에 쓰는 시간의 상한(PERF-U8-01). 앱의 15초 대기(BR-U8-44)보다 짧다.
 * @property interpretStageMaxMs 해석 한 번의 상한(PERF-U8-02) — 턴 잔여가 이보다 적으면 잔여만큼만 준다.
 * @property editStageMaxMs 편집 제안 한 번의 상한(O-U8-3 제안값) — 해석 뒤에 남은 턴 예산이 이보다 적으면 그만큼만 준다.
 * @property proposalTtlMinutes 제안이 [적용]을 기다리는 시간(O-U8-4 제안값). 지나면 `EXPIRED` 다.
 * @property readMarginMs 상대에 주는 계산 예산에서 빼 두는 왕복 여유(PERF-U8-01) — 응답을 읽는 시간까지 턴 예산 안에 들게.
 * @property rateLimitPerMinute 계정당 분당 사용자 턴(BR-U8-24). 빠른 답도 센다.
 * @property dailyLlmTurnLimit 계정당 하루 LLM 턴(COST-U8-02). 넘으면 막지 않고 버튼 모드로 낮춘다.
 *   **근거 없는 초기값이다** — 사용 분포가 관측되면 여기만 돌린다.
 * @property monthlyLlmCallLimit 서비스 전역의 이번 달 LLM 턴 상한(COST-U8-04). 넘으면 **모든 계정**이 버튼 모드로 낮아지고
 *   달이 바뀌면 풀린다. **세는 것은 호출이 아니라 LLM 을 쓴 턴이다** — 한 턴이 두 번 부를 수 있으니(해석 + 발화 편집)
 *   "월 예산 ÷ 호출당 단가"로 잡을 때는 절반으로 본다. **0 이면 꺼져 있다** — 운영 기본값은 `application.yml` 의 어림값이고, 호출당 단가를 실측하면 다시 정한다(PERF-U8-03). 꺼져 있는 동안의 그물은
 *   벤더 콘솔의 지출 한도뿐이다(COST-U8-05) — 해석을 운영에 열기 전에 둘 중 하나는 걸려 있어야 한다.
 * @property usageRetentionDays 사용량 행 보관(DATA-U8-04) — 월 상한 집계에 필요한 만큼. 발화가 없는 카운터라 대화 보존과 따로다.
 * @property snapshotMaxDays 해석에 보내는 일정의 일자 수 상한(SEC-U8-08) — 입력 토큰이 곧 비용이고 지연이다.
 * @property snapshotMaxSlotsPerDay 같은 상한의 일자당 슬롯 수. 어느 쪽이든 넘으면 오늘 ±1일만 보낸다.
 * @property interpret 해석 스위치(REL-U8-06) — `off` 는 운영자가 거는 버튼 모드, `fake` 는 대역(로컬 기본),
 *   `http` 는 상대의 `POST /ai/v1/dialogue/interpret`(TRIP-1410).
 */
@ConfigurationProperties(prefix = "trippilot.assistant")
data class AssistantProperties(
    val retentionDays: Long = 90,
    val turnBudgetMs: Long = 13_000,
    val interpretStageMaxMs: Long = 5_000,
    val editStageMaxMs: Long = 8_000,
    val proposalTtlMinutes: Long = 30,
    val readMarginMs: Long = 1_000,
    val rateLimitPerMinute: Int = 20,
    val dailyLlmTurnLimit: Int = 30,
    val monthlyLlmCallLimit: Long = 0,
    val usageRetentionDays: Long = 40,
    val snapshotMaxDays: Int = 14,
    val snapshotMaxSlotsPerDay: Int = 20,
    val interpret: Interpret = Interpret(),
) {
    val retention: Duration get() = Duration.ofDays(retentionDays)

    /**
     * @property baseUrl 상대 AI 서비스 주소 — 일정 경계와 같은 `AI_URL` 을 읽는다(같은 서비스다).
     * @property serviceToken 발신 자격(TRIP-856). 비면 붙이지 않는다 — 일정 경계와 같은 규칙.
     */
    data class Interpret(
        val mode: String = "fake",
        val baseUrl: String = "http://localhost:8000",
        val connectTimeoutMs: Long = 2_000,
        val serviceToken: String = "",
    )
}
