package com.trippilot.recalculation.api.event

import com.trippilot.core.event.DomainEvent

/**
 * 여행 중 재계획이 **일정에 반영됐다**(정본 §5 · `APPLIED` 시점). 변경 이력·기록(U5)이 소비한다.
 *
 * 산출(DRAFT)에서는 발행하지 않는다 — 확정 전에는 일정이 그대로라(INV-U4-05) 알릴 변경이 없다.
 */
data class ItineraryRecalculated(
    override val aggregateId: String, // tripId
    val replanSessionId: String,
) : DomainEvent {
    override val eventType: String = "recalculation.ItineraryRecalculated"
    override val aggregateType: String = "Trip"
}
