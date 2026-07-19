package com.trippilot.profile.domain

import java.time.Instant
import java.util.UUID

/**
 * 프로필(V1.5 profile). 닉네임(2~20자, 전역 유일 lower(nickname)) + 온보딩 완료 시각.
 * 닉네임 생성·금칙어 검증·설정은 TRIP-157(moderation facade), 온보딩 완료는 TRIP-159.
 * 여기(156)는 도메인·영속·조회만 소유. accountId 는 raw UUID(R1).
 */
class Profile private constructor(
    val accountId: UUID,
    val nickname: String,
    val nicknameUpdatedAt: Instant,
    val onboardingCompletedAt: Instant?,
) {
    val onboardingCompleted: Boolean get() = onboardingCompletedAt != null

    /** 닉네임 변경 — 온보딩 완료 시각은 보존. 길이 검증은 서비스(3검증)가 수행. */
    fun withNickname(nickname: String, now: Instant): Profile =
        Profile(accountId, nickname, now, onboardingCompletedAt)

    companion object {
        /** 최초 닉네임 설정(온보딩 중 프로필 생성). onboarding 미완료. */
        fun create(accountId: UUID, nickname: String, now: Instant): Profile =
            Profile(accountId, nickname, now, onboardingCompletedAt = null)

        fun reconstitute(
            accountId: UUID,
            nickname: String,
            nicknameUpdatedAt: Instant,
            onboardingCompletedAt: Instant?,
        ): Profile = Profile(accountId, nickname, nicknameUpdatedAt, onboardingCompletedAt)
    }
}
