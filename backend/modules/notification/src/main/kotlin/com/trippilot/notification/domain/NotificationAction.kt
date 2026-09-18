package com.trippilot.notification.domain

/**
 * 알림에서 들어갈 화면의 어휘(BR-U6-08·12 · TRIP-615).
 *
 * ## 왜 한 곳에 모으나
 *
 * 이 값들은 원래 발행하는 파일마다 흩어져 있었고(`TRIP_ITINERARY` 는 두 곳에 따로 선언돼 있었다),
 * 그 사이 계약(`openapi.yaml` 의 `Notification.actionType`)은 **한 값에서 멈춰 있었다** —
 * 코드가 셋을 내보내는 동안 계약은 하나만 선언한 상태로 게이트가 전부 초록이었다.
 * 그게 이 티켓이 생긴 이유다. 값을 고치는 것만으로는 같은 일이 다시 난다.
 *
 * 그래서 **어휘의 주인을 하나로 두고**, [ALL] 과 계약의 enum 이 같은 집합인지 테스트가 대조한다.
 * 값을 늘리려면 여기와 계약을 함께 고쳐야 하고, 한쪽만 고치면 빌드가 막힌다.
 */
object NotificationAction {
    /** 그 여행의 일정 화면. 리마인드(TRIP_PRE·TRIP_DAY·SLOT_PRE)가 쓴다. */
    const val TRIP_ITINERARY = "TRIP_ITINERARY"

    /** 재계획 진입 — 일정 화면이 아니다(BR-U6-08 '대안 일정 보기'). */
    const val PLANB_REPLAN = "PLANB_REPLAN"

    /** 하루 회고. 여행 하나에 여러 장이라 payload 에 날짜가 함께 간다. */
    const val REFLECTION_DAILY = "REFLECTION_DAILY"

    /** 여행 요약. */
    const val TRIP_SUMMARY = "TRIP_SUMMARY"

    /** 등록된 숙소 상세. */
    const val STAY_DETAIL = "STAY_DETAIL"

    /**
     * 계약과 대조하는 기준 집합.
     *
     * **액션이 없는 알림은 `null` 이고 여기 들어가지 않는다** — 회고에 쓸 데이터가 없어 만들지
     * 못한 알림이 그 경우다(BR-U6-12). 없는 액션에 이름을 붙이면 화면이 그것을 그린다(INV-4).
     */
    val ALL = setOf(TRIP_ITINERARY, PLANB_REPLAN, REFLECTION_DAILY, TRIP_SUMMARY, STAY_DETAIL)
}
