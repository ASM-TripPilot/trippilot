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
 * @property readMarginMs 상대에 주는 계산 예산에서 빼 두는 왕복 여유(PERF-U8-01) — 응답을 읽는 시간까지 턴 예산 안에 들게.
 * @property rateLimitPerMinute 계정당 분당 사용자 턴(BR-U8-24). 빠른 답도 센다.
 * @property dailyLlmTurnLimit 계정당 하루 LLM 턴(COST-U8-02). 넘으면 막지 않고 버튼 모드로 낮춘다.
 *   **근거 없는 초기값이다** — 사용 분포가 관측되면 여기만 돌린다.
 * @property interpret 해석 스위치(REL-U8-06) — `off` 는 운영자가 거는 버튼 모드, `fake` 는 대역(로컬 기본).
 *   `http` 는 상대 경계가 열리면 붙는다 — 지금 고르면 기동이 실패한다(조용히 버튼 모드가 되는 것보다 낫다).
 */
@ConfigurationProperties(prefix = "trippilot.assistant")
data class AssistantProperties(
    val retentionDays: Long = 90,
    val turnBudgetMs: Long = 13_000,
    val interpretStageMaxMs: Long = 5_000,
    val readMarginMs: Long = 1_000,
    val rateLimitPerMinute: Int = 20,
    val dailyLlmTurnLimit: Int = 30,
    val interpret: Interpret = Interpret(),
) {
    val retention: Duration get() = Duration.ofDays(retentionDays)

    data class Interpret(val mode: String = "fake")
}
