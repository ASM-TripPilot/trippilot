package com.trippilot.itinerarygeneration.application

import java.time.LocalDate
import java.util.UUID

/**
 * 슬롯 지시 키 — `"{date}#{poiId}"`(BR-U2-04). AI `explanations` 맵의 키 규약이다.
 *
 * ⚠ **아직 AI 와 합의되지 않았다** — 계약 문서에 `explanations` 키 의미가 협의 중(TRIP-282)으로 남아 있고,
 * AI 쪽 산출물은 `poiId` 만으로 키를 잡는 형태가 관측된다. 어긋나면 매칭이 전부 실패해 근거가 **조용히**
 * 사라지므로, 호출부에서 "받았는데 하나도 안 붙은" 경우를 로그로 드러낸다([warnIfUnmatched]).
 */
object SlotKey {
    fun of(date: LocalDate, poiId: UUID): String = "$date#$poiId"

    /**
     * 근거를 받았는데 **하나도 매칭되지 않으면** 키 규약이 어긋난 것이다 — 침묵하면 "AI 가 근거를 안 준 것"과
     * 구분되지 않는다(INV-4 취지). 값 자체는 버리지 않고 그대로 두고 신호만 남긴다.
     */
    fun warnIfUnmatched(received: Int, matched: Int, tripId: UUID) {
        if (received > 0 && matched == 0) {
            log.warn(
                "추천 근거 {}건을 받았지만 슬롯에 하나도 붙지 않았습니다 — explanations 키 규약 불일치 의심(BR-U2-04). tripId={}",
                received, tripId,
            )
        }
    }

    private val log = org.slf4j.LoggerFactory.getLogger(SlotKey::class.java)
}
