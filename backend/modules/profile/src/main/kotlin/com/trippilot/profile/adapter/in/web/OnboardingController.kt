package com.trippilot.profile.adapter.`in`.web

import com.trippilot.profile.application.OnboardingService
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RestController
import java.security.Principal
import java.time.Instant

/** 온보딩 완료(Bearer). 필수 약관+닉네임 충족 시 완료 기록(멱등). 미충족은 400. */
@RestController
@RequestMapping("/api/v1/onboarding")
class OnboardingController(
    private val onboarding: OnboardingService,
) {
    @PostMapping("/complete")
    fun complete(principal: Principal): OnboardingCompleteResponse =
        OnboardingCompleteResponse(onboarding.complete(principal.accountId()))
}

/** POST /onboarding/complete 응답. */
data class OnboardingCompleteResponse(val onboardingCompletedAt: Instant)
