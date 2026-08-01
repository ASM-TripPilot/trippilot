package com.trippilot.core.event

import java.time.Instant
import java.util.UUID

/**
 * 이벤트 봉투(U1-내부아키텍처 §2.1) — 트랜잭셔널 아웃박스 적재·발행용 직렬화 표현.
 * `eventId` 는 멱등 키(전 구독자 이 값으로 중복 제거).
 * 아웃박스 릴레이(@Scheduled + ShedLock)는 후속 — 여기선 계약 타입만 소유한다.
 */
data class EventEnvelope(
    val eventId: UUID,
    val eventType: String,
    val schemaVersion: Int,
    val aggregateType: String,
    val aggregateId: String,
    val correlationId: String?,
    val occurredAt: Instant,
    /** 직렬화된 payload(JSON 문자열). */
    val payload: String,
)
