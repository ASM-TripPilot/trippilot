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

    /**
     * 날짜별 **그 날 갈 곳의 이름**(방문 순서) — 리마인드 문구의 재료다(TRIP-883).
     *
     * ## 왜 이름을 여기서 주나
     *
     * [findPlanSlots] 는 `poiId` 만 준다. 호출측이 이름을 직접 얻으려면 place-data 를 따로 물어야
     * 하는데, 그 순간 **"어느 이름이 이기는가"라는 규칙이 두 모듈로 갈린다.** 확정된 슬롯은
     * 동결 이름이 이기고(INV-U1-03 — 원본이 폐업·개명돼도 확정 당시의 장소를 말해야 한다)
     * 그 판단은 일정(C8)이 이미 소유한다(`SlotSurfaceAssembler`). 그래서 이름까지 여기서 준다.
     *
     * ## 무엇이 "그 날 슬롯"인가
     *
     * [findPlanSlots] 와 **같은 정의**다 — 그 여행의 현재 일정, 확정 여부를 가리지 않는다.
     * 정의를 새로 만들지 않은 것은 의도다: 리마인드만 다른 일정을 말하면 화면과 알림이 어긋난다.
     *
     * 표면을 못 찾은 슬롯은 **빠진다** — 이름 없이 알릴 수는 없고, `poiId` 를 문구에 넣을 수도 없다.
     * 그 날 전부가 빠지면 키 자체가 없다(빈 목록이 아니라). 호출측은 그것을 "재료 없음"으로 읽는다.
     */
    fun findPlannedPlaceNames(accountId: UUID, tripId: UUID): Map<LocalDate, List<String>>
}

/**
 * 계획 슬롯 한 칸(api-safe).
 *
 * @property slotKey 경계 키 `"{date}#{poiId}"`(BR-U2-04) — 실적과 견주는 유일한 연결 고리다.
 * @property isFixed 사용자가 시각을 못 박은 슬롯(BR-U4-18). **기본값을 두지 않는다** — 모르는 채
 *   false 로 넘기면 "고정이 아니다"라는 없는 사실이 생기고, 재계획 전후 비교가 그것을 그대로 보여준다.
 * @property endsNextDay 자정을 넘기는 슬롯(HC4). true 면 [endAt] 이 [startAt] 보다 이르다.
 */
data class PlannedSlotView(
    val slotKey: String,
    val date: LocalDate,
    val poiId: UUID,
    val orderIndex: Int,
    val startAt: LocalTime,
    val endAt: LocalTime,
    val isFixed: Boolean,
    val endsNextDay: Boolean,
)
