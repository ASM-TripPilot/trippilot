package com.trippilot.itinerarygeneration.application

import java.time.LocalDate
import java.util.UUID

/**
 * 슬롯 지시 키 — `"{date}#{poiId}"`(BR-U2-04). `explanations` 키와 `Violation.slotKey` 가 **같은 규약**을 쓴다.
 * 한 곳에만 두는 이유: 양쪽이 따로 만들면 규약이 갈라져 근거가 슬롯에 안 붙는다(조용히 빈 값이 된다).
 */
object SlotKey {
    fun of(date: LocalDate, poiId: UUID): String = "$date#$poiId"
}
