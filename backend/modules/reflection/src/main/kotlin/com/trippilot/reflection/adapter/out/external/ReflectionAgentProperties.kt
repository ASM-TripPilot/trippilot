package com.trippilot.reflection.adapter.out.external

import org.springframework.boot.context.properties.ConfigurationProperties

/**
 * 회고 AI 연동 설정(O-U5-6 = `http`).
 *
 * [mode]=`rule`(기본)이면 [ReflectionAgentConfiguration] 의 미배선 구현이 물리고 규칙 카드로 간다.
 * `http` 면 [HttpReflectionAgentAdapter] 가 물린다.
 *
 * **기본값이 `rule` 인 이유**: 켜는 판단이 품질 관측 뒤에 오기 때문이다(BR-U5-33 — `source` 로 잰다).
 * 켜지 않은 환경에서 회고가 죽지 않는 것이 더 중요하다.
 *
 * [deadlineMs] 8s → 15s (2026-09-11 실 왕복 실측). 상대는 이 값을 **시도당 타임아웃으로 관통**시킨다
 * (`agents/reflect/agent.py` — 최대 3회 시도, 위반 0 후보가 나오면 조기 종료. 총량 상한이 아니다).
 * 8s 면 실 LLM 시도 1회(웜 5.1~6.5s)가 온전히 끝나기 빠듯해 위반·파싱실패 후보 → 재시도가 이어졌고,
 * 총 소요가 실측 11.8s+ 로 백스톱(마감+5s = 13s) 경계에 걸려 그날 상태에 따라 깨진 응답이 왔다 —
 * 규칙 카드 폴백이 사실상 기본 동작이 되어 있었다. 15s 면 첫 시도가 여유 있게 끝나 실측 5.1~6.5s
 * 단발로 수렴한다 — 마감을 늘렸는데 대기가 짧아지는 역설(일정 3s→25s 상향과 같은 부류).
 *
 * [readTimeoutMs] 는 **상대 백스톱(마감+5s)보다 커야 한다.** 같으면(예전처럼 한 속성이 겸하면)
 * 상대가 마감을 넘겨 정리하는 동안 우리가 소켓을 먼저 끊어, 성공 직전 응답도 규칙 카드로 강등된다.
 * 관계가 뒤집히는 설정은 기동에서 막는다(아래 require). 대가: AI 가 행에 빠지는 최악 경우의 대기
 * 상한이 8s → ~20s(백스톱)로 늘었다 — 정상 경로가 실제로 성공하는 값이 우선이고, 실패 시 규칙
 * 카드 즉시 폴백은 그대로다.
 */
@ConfigurationProperties(prefix = "trippilot.ai.reflection")
data class ReflectionAgentProperties(
    val mode: String = "rule",
    val baseUrl: String = "http://localhost:8000",
    val connectTimeoutMs: Long = 3_000,
    /** `request_meta.deadline_ms` 로 상대에 실리는 값. */
    val deadlineMs: Long = 15_000,
    val readTimeoutMs: Long = 21_000,
) {
    init {
        require(readTimeoutMs >= deadlineMs + AI_BACKSTOP_MARGIN_MS) {
            "readTimeoutMs($readTimeoutMs)는 마감+백스톱(${deadlineMs + AI_BACKSTOP_MARGIN_MS})보다 " +
                "작을 수 없습니다 — 상대가 마감을 넘겨 정리하는 응답을 우리가 먼저 끊게 됩니다."
        }
    }

    companion object {
        /**
         * 상대 `timeout_backstop` = deadline_ms + 5s (2026-09-11 실측 — deadline 8000 에 backstop 13000).
         * 5s 는 상대 설정 `TRIPPILOT_TIMEOUT_MARGIN_MS` 의 기본값이다 — 그쪽이 마진을 늘리는 건 무해하고,
         * 줄이면 이 가드가 요구하는 여유가 과해질 뿐 깨지지는 않는다.
         */
        const val AI_BACKSTOP_MARGIN_MS = 5_000L
    }
}
