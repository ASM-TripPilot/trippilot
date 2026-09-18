package com.trippilot.profile.application

import com.trippilot.auth.api.ConsentFacade
import com.trippilot.core.error.FieldError
import com.trippilot.core.error.ValidationFailed
import com.trippilot.profile.domain.ProfileRepository
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import java.time.Clock
import java.time.Instant
import java.util.UUID

/**
 * 온보딩 완료 처리(FD-U1-09, INV-P2). 전제: 필수 약관(이용약관·개인정보) 동의 + 닉네임 설정.
 * 멱등 — 이미 완료면 기존 시각 반환. 전제 미충족은 400.
 * 필수 동의 확인은 auth.api 퍼사드(R1), 닉네임·완료기록은 profile 자체.
 */
@Service
class OnboardingService(
    private val consentFacade: ConsentFacade,
    private val profiles: ProfileRepository,
    private val clock: Clock,
) {
    @Transactional
    fun complete(accountId: UUID): Instant {
        if (!consentFacade.hasCompletedOnboardingConsents(accountId)) {
            throw ValidationFailed(listOf(FieldError("consents", "필수 약관(이용약관·개인정보) 동의가 필요합니다")))
        }
        // 프로필은 닉네임 설정 시 생성됨 — 없으면 닉네임 미설정(INV-P2)
        val profile = profiles.find(accountId)
            ?: throw ValidationFailed(listOf(FieldError("nickname", "닉네임 설정이 필요합니다")))

        val completed = profiles.save(profile.completeOnboarding(clock.instant())) // 멱등
        return completed.onboardingCompletedAt!!
    }
}
