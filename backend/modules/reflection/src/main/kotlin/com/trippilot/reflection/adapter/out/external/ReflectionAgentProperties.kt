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
 * [readTimeoutMs] 는 짧다. 회고 생성은 **사용자가 화면에서 기다리는 동작**이고, 못 만들면 규칙 카드가
 * 즉시 나온다 — 오래 매달릴 이유가 없다. 일정 생성(수십 초)과 성격이 다르다.
 */
@ConfigurationProperties(prefix = "trippilot.ai.reflection")
data class ReflectionAgentProperties(
    val mode: String = "rule",
    val baseUrl: String = "http://localhost:8000",
    val connectTimeoutMs: Long = 3_000,
    val readTimeoutMs: Long = 8_000,
)
