package com.trippilot.itinerarygeneration.api

import java.time.LocalDate
import java.time.LocalTime
import java.util.UUID

/**
 * 계획 슬롯 조회(C8) — 공개 계약(R1, `..api..`).
 *
 * [ItineraryFacade] 와 따로 두는 이유는 파급이다. 그쪽은 재계획·감지 등 네 모듈이 구현·대역으로
 * 물고 있어 메서드 하나가 그 전부를 건드린다. 여기 호출자는 **기록 화면**(U5 3종 비교)이고
 * 필요로 하는 것도 다르다 — 요약이 아니라 **슬롯별 계획 시각**이다.
 */
interface ItineraryPlanFacade {
    /** 소유 여행의 현재 일정 계획 슬롯. 없거나 타 계정이면 빈 목록(존재 은닉은 호출측 몫). */
    fun findPlanSlots(accountId: UUID, tripId: UUID): List<PlannedSlotView>
}

/**
 * 계획 슬롯 한 칸(api-safe).
 *
 * @property slotKey 경계 키 `"{date}#{poiId}"`(BR-U2-04) — 실적과 견주는 유일한 연결 고리다.
 * @property endsNextDay 자정을 넘기는 슬롯(HC4). true 면 [endAt] 이 [startAt] 보다 이르다.
 */
data class PlannedSlotView(
    val slotKey: String,
    val date: LocalDate,
    val poiId: UUID,
    val orderIndex: Int,
    val startAt: LocalTime,
    val endAt: LocalTime,
    val endsNextDay: Boolean,
)
