package com.trippilot.itinerarygeneration.api

import java.time.LocalDate
import java.util.UUID

/**
 * 일정 조회 퍼사드(C8) — 타 모듈이 의존하는 공개 계약(R1, `..api..`).
 *
 * 왜 여는가: U4 재계획은 세션에 **어느 일정을 다시 짜는지**(`itineraryId`)를 담아야 하고(정본 §3.2),
 * 완료된 방문지를 재계획에서 잠그려면 슬롯 키가 필요하다(INV-U4-04). 그 값들을 얻자고 재계획 모듈이
 * 일정 모듈 내부를 들여다보면 R1 위반이다.
 *
 * **api-safe 타입만 노출**한다 — 일정 내부 도메인(Itinerary·VisitSlot)은 넘기지 않는다.
 * 슬롯은 물리 키(visit_slot_id)가 아니라 **경계 키 `slotKey`**(BR-U2-04 `"{date}#{poiId}"`)로 가리킨다.
 * 재계획으로 슬롯 행이 갈려도 참조가 끊기지 않아야 하기 때문이다(정본 §1 slotKey 규약).
 */
interface ItineraryFacade {
    /** 소유 여행의 현재 일정 요약. 없거나 삭제·타 계정이면 null(호출 측이 404 존재 은닉으로 매핑). */
    fun findCurrent(accountId: UUID, tripId: UUID): ItineraryRef?
}

/**
 * 일정 요약(api-safe).
 *
 * @property slotKeys 표시 순서대로의 슬롯 경계 키. 재계획 범위·잠금 판정의 입력이다.
 */
data class ItineraryRef(
    val itineraryId: UUID,
    val status: String,          // PLANNED | CONFIRMED — 문자열로 넘긴다(내부 enum 을 계약에 싣지 않는다)
    val generationState: String, // PARTIAL | COMPLETE | FAILED
    val dates: List<LocalDate>,
    val slotKeys: List<String>,
)
