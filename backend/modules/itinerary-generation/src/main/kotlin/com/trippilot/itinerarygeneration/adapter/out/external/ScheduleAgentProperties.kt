package com.trippilot.itinerarygeneration.adapter.out.external

import org.springframework.boot.context.properties.ConfigurationProperties

/**
 * AI 일정 생성 서비스(U5) 연동 설정. 경로·타임아웃은 경계 계약(PR #104) 확정치.
 * [mode]=fake(기본)면 [FakeScheduleAgent], `http` 면 [HttpScheduleAgentAdapter] 가 우선(@Primary) 주입된다.
 * [readTimeoutMarginMs]: AI `deadline_ms` 는 **내부 계산 예산**이라 네트워크 홉이 빠져 있음 → read-timeout = 최대시한 + 마진.
 */
@ConfigurationProperties(prefix = "trippilot.ai.schedule")
data class ScheduleAgentProperties(
    val mode: String = "fake",
    val baseUrl: String = "http://localhost:8000",
    val maxDeadlineMs: Long = 20_000,       // 전체 생성 시한(IO-1) — 백엔드가 거는 상한의 기준
    val readTimeoutMarginMs: Long = 2_000,
    val connectTimeoutMs: Long = 3_000,
)
