package com.trippilot.savedaccommodation.api.event

import com.trippilot.core.event.DomainEvent

/**
 * 거점 커버리지 해소 완료 — **전 숙박일이 확정된 순간**에만 발행한다(BR-U1-46).
 * 이 이벤트가 AI 일정 생성 게이트를 연다(INV-U1-16). 아직 미해결 날짜가 남아 있으면 발행하지 않는다 —
 * 게이트가 열렸다고 잘못 알리면 소비자가 좌표 없는 날짜로 일정을 짠다.
 */
data class TripBaseResolved(
    override val aggregateId: String, // tripId
) : DomainEvent {
    override val eventType: String = "stay.TripBaseResolved"
    override val aggregateType: String = "Trip"
}
