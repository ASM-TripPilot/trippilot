package com.trippilot.itinerarygeneration.adapter.out.external

import org.springframework.boot.context.properties.ConfigurationProperties

/**
 * AI 일정 생성 서비스(U5) 연동 설정. 경로·타임아웃은 경계 계약(PR #104) 확정치.
 * [mode]=fake(기본)면 [FakeScheduleAgent], `http` 면 [HttpScheduleAgentAdapter] 가 우선(@Primary) 주입된다.
 * [readTimeoutMarginMs]: AI 시한은 **내부 계산 예산**이라 네트워크 홉이 빠져 있음 → read 상한 = 대기 상한 + 마진.
 * 대기 상한 자체는 여기 없다 — 시한을 거는지 여부에 따라 갈리므로
 * [com.trippilot.itinerarygeneration.application.ScheduleDeadlineProperties] 가 소유하고 여기선 파생만 한다.
 * 사본을 두면 한쪽만 올린 절반 설정이 나오고, 그때 증상은 "AI 를 붙였는데 전부 폴백"이라 원인이 안 보인다.
 */
@ConfigurationProperties(prefix = "trippilot.ai.schedule")
data class ScheduleAgentProperties(
    val mode: String = "fake",
    val baseUrl: String = "http://localhost:8000",
    val readTimeoutMarginMs: Long = 2_000,
    val connectTimeoutMs: Long = 3_000,
)
