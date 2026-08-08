package com.trippilot.itinerarygeneration.application

import com.trippilot.itinerarygeneration.domain.Itinerary

/**
 * "내용이 실제로 달라졌는가" 판정.
 *
 * 이력·리비전을 쌓을지 정하는 데 쓴다. 두 가지를 피하려고 따로 뒀다.
 * - **복원용 스냅숏으로 비교하면** 위반 상태(플래그·사유)가 빠져 있어, 재검증으로 위반만 달라진 변경을
 *   "변화 없음"으로 보고 그 갱신을 통째로 건너뛴다.
 * - **도메인 객체를 그대로 비교하면** [com.trippilot.itinerarygeneration.domain.VisitSlot] 이
 *   data class 가 아니라 참조 비교가 돼 **항상 다르다**고 나온다(무의미한 이력이 매번 쌓인다).
 */
internal object ItineraryContent {

    fun sameAs(a: Itinerary, b: Itinerary): Boolean = a.fingerprint() == b.fingerprint()

    /** 표시·판정에 쓰이는 값 전부. 여기서 빠뜨린 필드는 "바뀌어도 안 바뀐 것"이 된다. */
    private fun Itinerary.fingerprint(): List<Any?> = days.flatMap { d ->
        listOf(d.date, d.dayOrder) + d.slots.flatMap { s ->
            listOf(
                s.sourcePoiId, s.orderIndex, s.startAt, s.endAt,
                s.isFixed, s.endsNextDay, s.hasViolation, s.violationReason,
                s.distanceRange, s.placementReason,
            )
        }
    }
}
