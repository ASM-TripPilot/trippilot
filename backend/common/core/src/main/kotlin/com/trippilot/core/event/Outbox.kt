package com.trippilot.core.event

/**
 * 아웃박스 적재 포트(TRIP-539) — 업무 변경과 **같은 트랜잭션**에서 쓰인다.
 *
 * 그것이 트랜잭셔널 아웃박스의 전부다: 업무가 커밋되면 이벤트도 커밋되고, 롤백되면 둘 다 없다.
 * 인프로세스 발행만 있던 시절에는 "업무는 저장됐는데 이벤트는 사라진" 구간이 존재했다.
 *
 * 구현은 `app` 이 소유한다 — 이 모듈은 스프링·JDBC 를 모른다(플랫폼 최하위).
 */
interface OutboxStore {
    fun append(envelope: EventEnvelope)
}

/**
 * 릴레이가 배달하는 구독 계약(TRIP-539).
 *
 * **인프로세스 `@EventListener` 와 별개다.** 기존 구독자를 릴레이로 옮기지 않는 이유는,
 * 옮기는 순간 같은 이벤트가 두 경로로 가거나(중복) 한 경로가 조용히 끊기기 때문이다.
 * at-least-once 가 필요한 새 소비자만 이쪽에 붙는다(U6 알림이 첫 소비자).
 *
 * **여러 번 불릴 수 있다.** 배달 후 발행 표시 전에 프로세스가 죽으면 다음 폴링이 다시 배달한다 —
 * 구현체가 [EventEnvelope.eventId] 로 멱등을 보장해야 한다.
 */
interface OutboxSubscriber {
    /** 이 구독자가 받을 이벤트 타입 — 예 `"itinerary.ItineraryGenerated"`. */
    val eventType: String

    fun handle(envelope: EventEnvelope)
}
