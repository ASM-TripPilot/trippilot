package com.trippilot.itinerarygeneration.domain

import java.util.UUID

/**
 * 이 여행에 **다녀온 기록**(도착·완료·건너뜀·즉석 방문)이 하나라도 있나 — 재생성 가드가 묻는다.
 *
 * 재생성은 기존 일정을 지우고 새로 만든다. 기록은 `trip_id + slotKey` 로 남아 삭제를 견디므로, 기록이 있는
 * 여행을 통째로 다시 짜면 계획에 없는 장소에 "방문 완료"가 남는다(유령 실적). 기록이 없으면 그 피해가 없다.
 *
 * `archive.api` 를 직접 부르지 않는 이유는 [PersonalizationPort] 와 같다 — `archive → itinerary-generation`
 * 이라 여기서 archive 를 물면 순환이다. 연결은 app 이 한다.
 */
fun interface VisitRecordPort {
    fun hasAny(tripId: UUID): Boolean
}
