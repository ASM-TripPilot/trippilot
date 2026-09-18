package com.trippilot.auth.domain

import java.time.Instant
import java.util.UUID

/**
 * 삭제 유예 예약(V1.4 deletion_schedule). 계정당 활성(cancelled_at IS NULL) 최대 1개(INV-D1).
 * purgeAt = requestedAt + 30일. 실제 파기는 후속 배치가 purge_at 폴링으로 수행(158 스코프 밖).
 */
class DeletionSchedule private constructor(
    val deletionId: UUID,
    val accountId: AccountId,
    val requestedAt: Instant,
    val purgeAt: Instant,
    val cascadeSummary: CascadeSummary,
    val cancelledAt: Instant?,
) {
    val active: Boolean get() = cancelledAt == null

    fun cancel(now: Instant): DeletionSchedule =
        DeletionSchedule(deletionId, accountId, requestedAt, purgeAt, cascadeSummary, cancelledAt = now)

    companion object {
        fun create(accountId: AccountId, requestedAt: Instant, purgeAt: Instant, cascadeSummary: CascadeSummary): DeletionSchedule =
            DeletionSchedule(UUID.randomUUID(), accountId, requestedAt, purgeAt, cascadeSummary, cancelledAt = null)

        fun reconstitute(
            deletionId: UUID,
            accountId: AccountId,
            requestedAt: Instant,
            purgeAt: Instant,
            cascadeSummary: CascadeSummary,
            cancelledAt: Instant?,
        ): DeletionSchedule = DeletionSchedule(deletionId, accountId, requestedAt, purgeAt, cascadeSummary, cancelledAt)
    }
}

/**
 * 연쇄 삭제 범위 고지(deletion_schedule.cascade_summary). U1 스냅샷:
 * 파기 예정 범주 + 법정 보존 범주(동의 증적·위치 법정 로그는 파기하지 않음, INV-D3).
 */
data class CascadeSummary(
    val purgeScheduled: List<String>,
    val legallyRetained: List<String>,
) {
    companion object {
        /**
         * 삭제 시 함께 파기되는 범주 — **목록의 정본은 BR-U6-25** 다("목록은 U6 가 소유하며 유닛이
         * 늘 때마다 갱신한다"). 값은 테이블명 대문자(기존 관례) — 표시 라벨은 화면 몫이다.
         *
         * **U1 시점에 동결돼 있던 것을 2026-09-06 에 갱신했다.** 원래 주석이 "새 유닛에서 개인정보
         * 테이블을 추가하면 반드시 반영할 것(파기 고지 누락=법적 리스크)"이라 경고해 뒀는데,
         * U3·U5·U6 다섯 유닛이 지나는 동안 아무도 반영하지 않았다 — 사람이 기억해야 하는 규칙은
         * 지켜지지 않는다. 그래서 이제는 `DeletionCascadeNoticeIT` 가 **실 DB 의 FK 를 훑어**
         * account 직결 CASCADE 테이블이 이 목록에 빠지면 빌드를 깨뜨린다.
         *
         * trip 하위(목적지·일정·방문기록·사진 메타·메모·회고·요약 등)는 account 직결 FK 가 아니라
         * trip 을 거쳐 연쇄되지만, **고지는 사용자 기준**이라 BR-U6-25 대로 명시한다.
         */
        fun forAccount(): CascadeSummary = CascadeSummary(
            purgeScheduled = listOf(
                // U1 — 계정 부속
                "PROFILE", "PREFERENCE_SET", "LOCATION_CONSENT_STATE", "MARKETING_CONSENT", "SOCIAL_IDENTITY",
                // U1 — 등록·저장 숙소·장소
                "SAVED_STAY", "SAVED_PLACE",
                // U3 — 여행·일정(trip 연쇄로 목적지·거점·필수방문지·일정·리비전까지)
                "TRIP", "ITINERARY", "GENERATION_SESSION",
                // U5 — 방문 기록·사진 메타·메모(trip 연쇄)
                "VISIT_CHECK", "VISIT_PHOTO_META", "VISIT_MEMO",
                // U5 — 회고·요약·스타일 분석
                "REFLECTION", "TRIP_SUMMARY", "STYLE_ANALYSIS",
                // U6 — 알림함·푸시 토큰·알림 설정·앱 설정·Plan-B 민감도
                "NOTIFICATION", "NOTIFICATION_SCHEDULE", "NOTIFICATION_TOGGLE",
                "PUSH_TOKEN", "ACCOUNT_SETTING", "PLAN_B_SENSITIVITY",
            ),
            // 법정 보존(INV-D3) — 동의 증적·위치 법정 로그는 파기하지 않는다.
            legallyRetained = listOf("CONSENT_RECORD", "LOCATION_LEGAL_LOG"),
        )
    }
}
