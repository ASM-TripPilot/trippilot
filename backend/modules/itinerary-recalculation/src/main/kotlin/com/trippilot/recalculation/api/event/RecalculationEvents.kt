package com.trippilot.recalculation.api.event

import com.trippilot.core.event.DomainEvent

/**
 * 여행 중 재계획이 **일정에 반영됐다**(정본 §5 · `APPLIED` 시점). 변경 이력·기록(U5)·알림(리마인드 재적재)·
 * 감지(C9 — 근거 트리거 소비)가 소비한다.
 *
 * 산출(DRAFT)에서는 발행하지 않는다 — 확정 전에는 일정이 그대로라(INV-U4-05) 알릴 변경이 없다.
 * 뒤 두 필드는 **선택**이다(옛 행·옛 구독자 호환 — 구독자는 JSON 트리로 읽는다).
 */
data class ItineraryRecalculated(
    override val aggregateId: String, // tripId
    val replanSessionId: String,
    /** 트리거 진입 재계획이면 그 트리거 id. 수동 재계획은 null. */
    val triggerId: String? = null,
    /** 다시 짠 날(yyyy-MM-dd). C9 는 트리거 날짜와 같을 때만 소비한다. */
    val targetDate: String? = null,
) : DomainEvent {
    override val eventType: String = "recalculation.ItineraryRecalculated"
    override val aggregateType: String = "Trip"
}
