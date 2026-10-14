package com.trippilot.archive.api.event

import com.trippilot.core.event.DomainEvent

/**
 * 방문 도착·완료 사건(U5 정본 §6 · G-U5-13 · U10 FD §12.6) — `api/event` 의 공개 계약(R1).
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
 * @property completedAt **도착이면 null, 완료면 값**이다 — U10 부터 도착에도 발행한다(G-U10-2). 구독자는 이 칸으로
 *   둘을 가른다. 건너뜀은 발행하지 않는다.
 * @property accountId 여행 소유자. 아웃박스 구독자는 사용자 요청 맥락이 없어 이것으로 판정 대상 계정을 안다(G-U10-3,
 *   `PlanBTriggered` 선례).
 *   ⚠ 이 칸과 [arrivalSource] 는 U10(V2.67) 배포부터 실린다 — 롤링 배포 창의 옛 파드가 쓴 행에는 없다. 그 행들은 구독자가
 *   없는 지금 릴레이가 닫는다. 첫 구독자(U10-DELAY)는 배포 뒤 행만 읽거나 두 칸을 없을 수 있는 값으로 다룬다.
 * @property arrivalSource 도착 출처(`AUTO_GEOFENCE`·`MANUAL`).
 * @property completionSource 완료 출처(`AUTO_GEOFENCE_EXIT`·`AUTO_NEXT_ARRIVAL`·`MANUAL`) — 완료일 때만 있다.
 *   `AUTO_NEXT_ARRIVAL` 의 체류는 이동 시간을 먹으므로 체류 초과 판정에 쓰지 않는다(BR-U10-24).
 */
data class VisitChecked(
    override val aggregateId: String, // visitCheckId
    val tripId: String,
    val slotKey: String?,
    val poiId: String,
    val arrivedAt: String,
    val completedAt: String?,
    val accountId: String,
    val arrivalSource: String,
    val completionSource: String?,
) : DomainEvent {
    override val eventType: String = "archive.VisitChecked"
    override val aggregateType: String = "VisitCheck"
}

/**
 * 하루치 실제 경로가 저장됐다(U10 FD §12.6) — 회고가 구독해 그날 거리 출처를 `ROUTE` 로 올리고 **통계만** 다시 센다(BR-U10-39).
 * 좌표는 싣지 않는다(INV-U10-2) — 필요한 쪽은 경로 조회로 읽는다.
 *
 * @property localDate 여행지 기준 날짜(`yyyy-MM-dd`).
 */
data class ActualRouteStored(
    override val aggregateId: String, // routeDayId
    val tripId: String,
    val accountId: String,
    val localDate: String,
    val distanceM: Int,
) : DomainEvent {
    override val eventType: String = "archive.ActualRouteStored"
    override val aggregateType: String = "ActualRouteDay"
}

/**
 * 자동 기록을 되돌렸다(U10 FD §12.2) — 지연 신호원이 구독해, 되돌린 도착·완료를 판정 입력에서 뺀다([[U10-DELAY]]).
 *
 * @property revertedPart `COMPLETION`(자동 완료를 비움 — 도착은 남음) · `ARRIVAL`(자동 도착을 비움 — 그날 자동 쓰기가 막힌다).
 */
data class VisitAutoReverted(
    override val aggregateId: String, // visitCheckId(정본 §12.6 의 visitCheckId)
    val tripId: String,
    val accountId: String,
    val slotKey: String?,
    val revertedPart: String,
) : DomainEvent {
    override val eventType: String = "archive.VisitAutoReverted"
    override val aggregateType: String = "VisitCheck"
}
