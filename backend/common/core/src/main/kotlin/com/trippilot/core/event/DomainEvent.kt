package com.trippilot.core.event

/**
 * 도메인 이벤트 마커 — 모듈이 발행하는 업무 이벤트(U1-내부아키텍처 §2).
 * 구현체는 각 모듈이 소유하며 프레임워크 의존 없이 정의한다.
 */
interface DomainEvent {
    /** 이벤트 타입 — 예 "auth.AccountCreated". */
    val eventType: String

    /** 애그리거트 타입 — 예 "Account". */
    val aggregateType: String

    /** 애그리거트 식별자. */
    val aggregateId: String

    /** 스키마 버전(진화 대비). */
    val schemaVersion: Int
        get() = 1
}
