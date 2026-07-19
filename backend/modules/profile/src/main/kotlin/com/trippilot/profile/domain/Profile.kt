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

    companion object {
        fun reconstitute(
            accountId: UUID,
            nickname: String,
            nicknameUpdatedAt: Instant,
            onboardingCompletedAt: Instant?,
        ): Profile = Profile(accountId, nickname, nicknameUpdatedAt, onboardingCompletedAt)
    }
}
