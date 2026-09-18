package com.trippilot.reflection.api.event

import com.trippilot.core.event.DomainEvent

/**
 * 회고가 준비됨(U5 정본 §6 · BR-U5-37).
 *
 * **U5 는 이벤트까지다.** 알림을 보낼지, 어떤 문구로 보낼지는 U6 소관이다 — 회고 모듈이 알림을 직접
 * 만들면 수신 설정·중복 억제가 두 곳에 흩어진다.
 *
 * 아웃박스 경유라 at-least-once 다 — 구독자가 [aggregateId] 로 멱등을 보장해야 한다.
 *
 * @property dayDate 하루 회고면 그 날짜, 여행 요약이면 null.
 * @property kind `DAILY` | `SUMMARY`.
 */
data class ReflectionReady(
    override val aggregateId: String, // reflectionId
    val tripId: String,
    val dayDate: String?,
    val kind: String,
    val source: String,
) : DomainEvent {
    override val eventType: String = "reflection.ReflectionReady"
    override val aggregateType: String = "Reflection"
}
