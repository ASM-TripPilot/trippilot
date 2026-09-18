package com.trippilot.archive.api.event

import com.trippilot.core.event.DomainEvent

/**
 * 방문 완료 사건(U5 정본 §6 · G-U5-13) — `api/event` 의 공개 계약(R1).
 *
 * **신설이지 이관이 아니다.** 설계 문서에만 있고 코드에는 없던 이벤트다 — 실적이 `archive` 소유가 되면서
 * 비로소 발행 주체가 정해졌다.
 *
 * 소비자는 아웃박스 릴레이 경유로 받는다(at-least-once) — U4 Plan-B 가 체류 초과를 판정하고,
 * U6 는 구독만 정의한다(알림은 아직 없다). 중복 배달은 [aggregateId] 로 걸러야 한다.
 *
 * @property slotKey **경계 키** `"{date}#{poiId}"`(BR-U2-04). 물리 키가 아닌 이유는 재계획으로 슬롯 행이
 *   갈려도 실적 참조가 끊기지 않아야 하기 때문이다. `null` 이면 **즉석 방문**이고, 즉석 방문은 plan 계층에
 *   어떤 행도 만들지 않는다(INV-U5-02) — 계획에 없던 곳은 끝까지 계획에 없다.
 * @property completedAt 정본이 정한 계약 모양대로 nullable 이다(§6). 지금은 완료 시에만 발행하므로 항상
 *   채워지지만, 도착·건너뜀까지 넓힐 때 구독자를 고치지 않으려고 모양을 좁히지 않았다.
 */
data class VisitChecked(
    override val aggregateId: String, // visitCheckId
    val tripId: String,
    val slotKey: String?,
    val poiId: String,
    val arrivedAt: String,
    val completedAt: String?,
) : DomainEvent {
    override val eventType: String = "archive.VisitChecked"
    override val aggregateType: String = "VisitCheck"
}
