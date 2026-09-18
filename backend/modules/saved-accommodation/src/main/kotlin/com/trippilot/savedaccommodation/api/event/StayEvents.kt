package com.trippilot.savedaccommodation.api.event

import com.trippilot.core.event.DomainEvent

/**
 * 숙소가 등록됐다(U1 · TRIP-550). 알림(U6)이 이 사건으로 `STAY` 알림을 적재한다.
 *
 * **발행부는 U6 밖이다** — 소유 모듈이 낸다. saved-accommodation 은 notification 을 모르고,
 * 배달은 아웃박스 릴레이가 한다(R1 · 순환 회피).
 *
 * `checkIn`·`checkOut` 을 싣는 이유는 알림 문구가 "언제 묵는 곳인지"를 말해야 하기 때문이다 —
 * 받는 쪽이 다시 조회하면 그 사이 수정·삭제된 숙소를 못 읽는다.
 */
data class StayRegistered(
    override val aggregateId: String, // savedStayId
    val accountId: String,
    val name: String,
    val checkIn: String,
    val checkOut: String,
) : DomainEvent {
    override val eventType: String = "stay.StayRegistered"
    override val aggregateType: String = "SavedStay"
}
