package com.trippilot.savedaccommodation.api.event

import com.trippilot.core.event.DomainEvent

/**
 * 숙소가 등록됐다(U1 · TRIP-550). 알림(U6)이 이 사건으로 `STAY` 알림을 적재한다.
 *
 * **발행부는 U6 밖이다** — 소유 모듈이 낸다. saved-accommodation 은 notification 을 모르고,
 * 배달은 아웃박스 릴레이가 한다(R1 · 순환 회피).
 *
 * 체크인·체크아웃을 싣지 않는다(BR-U6-01 개정 · TRIP-1066) — 유일한 소비처였던 알림 본문이
 * 숙소 이름만 쓰기로 바뀌었고, FE 가 등록에 날짜를 보내지 않게 되면서(TRIP-1052) 그 자리가
 * 전부 문자열 "null" 로 나가던 결함의 근원이었다.
 */
data class StayRegistered(
    override val aggregateId: String, // savedStayId
    val accountId: String,
    val name: String,
) : DomainEvent {
    override val eventType: String = "stay.StayRegistered"
    override val aggregateType: String = "SavedStay"
}
