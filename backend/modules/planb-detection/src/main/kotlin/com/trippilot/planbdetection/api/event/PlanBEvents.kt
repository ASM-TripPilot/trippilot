package com.trippilot.planbdetection.api.event

import com.trippilot.core.event.DomainEvent

/**
 * Plan-B 트리거가 **발화했다**(U4 · TRIP-550). 알림(U6)이 이 사건으로 `PLAN_B` 알림을 적재한다.
 *
 * **발화한 것만 나간다**(INV-U4-01) — 억제·무영향 판정도 행은 남지만 그건 관측용이고,
 * 사용자에게 알릴 일이 아니다. 그걸 알리면 "끄기"를 누른 것이 다시 울린다.
 *
 * [slotKey] 는 경계 키(`{date}#{poiId}`, BR-U2-04)다. 물리 키가 아니라 이것을 싣는 이유는
 * 일정이 교체돼도 참조가 끊기지 않아야 하기 때문이다.
 */
data class PlanBTriggered(
    override val aggregateId: String, // triggerId
    val accountId: String,
    val tripId: String,
    val kind: String,
    val slotKey: String?,
    val reason: String?,
) : DomainEvent {
    override val eventType: String = "planb.PlanBTriggered"
    override val aggregateType: String = "PlanBTrigger"
}
