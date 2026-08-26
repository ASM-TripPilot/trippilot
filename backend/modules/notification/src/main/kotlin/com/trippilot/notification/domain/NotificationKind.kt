package com.trippilot.notification.domain

/**
 * 알림 종류 8종(U6 정본 §2.5).
 *
 * DB 에는 `varchar` 로 저장하고 **CHECK 를 걸지 않는다.** 커뮤니티(U7)가 열릴 때 어휘를 넓히자고
 * 마이그레이션이 붙는 것을 피하기 위해서다 — 대신 검증은 [of] 가 한다. 어휘의 주인은 이 enum 하나다.
 */
enum class NotificationKind {
    /** 숙소 등록·저장 완료(U1 이벤트). */
    STAY,

    /** 여행 시작 전(D-1) — 스케줄러. */
    TRIP_PRE,

    /** 당일 일정 — 스케줄러. */
    TRIP_DAY,

    /** 일정 시작 전 — 스케줄러. */
    SLOT_PRE,

    /** Plan-B 재계획(U4 이벤트). */
    PLAN_B,

    /** 회고 완료(U5 이벤트). */
    REFLECTION,

    /** 커뮤니티 좋아요·댓글(U7 이벤트) — 아직 원천이 없다. */
    COMMUNITY,

    /** 보안·계정(U0 auth). INV-U6-03 토글과 무관하게 항상 적재된다. */
    SYSTEM,
    ;

    companion object {
        /**
         * 시각이 되어 발화하는 종류 — `notification_schedule` 이 담을 수 있는 전부다(정본 §2.4).
         * 나머지는 사건이 있어야 생기므로 예약할 대상이 없다.
         */
        val REMINDERS: Set<NotificationKind> = setOf(TRIP_PRE, TRIP_DAY, SLOT_PRE)

        /** DB·외부 문자열 → 종류. 모르는 값은 조용히 흡수하지 않는다(INV-4). */
        fun of(raw: String): NotificationKind =
            entries.firstOrNull { it.name == raw } ?: error("알 수 없는 알림 종류입니다: $raw")
    }
}
