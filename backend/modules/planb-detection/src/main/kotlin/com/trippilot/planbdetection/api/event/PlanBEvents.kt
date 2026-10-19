package com.trippilot.planbdetection.api.event

import com.trippilot.core.event.DomainEvent

/**
 * Plan-B 알림 사건(U4 · TRIP-550). 알림(U6)이 이 사건으로 `PLAN_B` 알림을 적재하고, 선계산(C10)이 위험이면 초안을 미리 짠다.
 *
 * **알린 것만 나간다**(INV-U4-01) — 억제·무영향·조용한 발화는 행만 남는다.
 * **여행·판정당 1건이다**(CD20) — [aggregateId] 는 대표 트리거(위험 → 이른 날짜 → 날짜 전체 → 이른 슬롯)이고,
 * 같이 알린 나머지는 [others] 로만 센다.
 *
 * 앞 6개는 위치 인자 그대로다(옛 생성 코드·옛 행 호환). 뒤 필드는 **모두 선택**이다 — 구독자는 JSON 트리로 읽고,
 * 없으면 옛 사건으로 다룬다. [slotKey] 는 경계 키(`{date}#{poiId}`, BR-U2-04)다.
 */
data class PlanBTriggered(
    override val aggregateId: String, // 대표 triggerId
    val accountId: String,
    val tripId: String,
    val kind: String,
    val slotKey: String?,
    val reason: String?,
    /** 대표의 영향 날짜(yyyy-MM-dd, 여행지 기준). */
    val affectedDate: String? = null,
    /** 대표의 재계획 범위(FULL_DAY·PARTIAL_SLOTS). */
    val scope: String? = null,
    /** 대표의 심각도(RISK·CAUTION). */
    val severity: String? = null,
    /** 대표의 변형(12종) — 모르면 null. */
    val variant: String? = null,
    /** 푸시 대상인가 — 위험 대표 ∧ 하루 상한 안. false 여도 알림함·배너는 남긴다. */
    val push: Boolean? = null,
    /** 같이 알린 나머지 대상 수(`(외 N건)`). */
    val others: Int? = null,
    /** 대표 날짜의 ACTIVE 위험 전부(대표 포함) — 선계산 재료. 사유·지시·제외 매핑은 C10 이 소유한다(CD10). */
    val dateRisks: List<DateRisk>? = null,
) : DomainEvent {
    override val eventType: String = "planb.PlanBTriggered"
    override val aggregateType: String = "PlanBTrigger"
}

/** 그 날의 위험 한 건 — kind·변형·영향 POI 만 싣는다. */
data class DateRisk(val kind: String, val variant: String?, val poiIds: List<String>)
