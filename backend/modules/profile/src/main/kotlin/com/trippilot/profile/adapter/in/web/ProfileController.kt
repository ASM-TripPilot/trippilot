package com.trippilot.profile.adapter.`in`.web

import com.trippilot.profile.application.ProfileQueryService
import com.trippilot.profile.domain.Profile
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RestController
import java.security.Principal
import java.time.Instant

/** 프로필 조회(Bearer). 닉네임 설정 전(프로필 미생성)은 404. */
@RestController
@RequestMapping("/api/v1/me/profile")
class ProfileController(
    private val profileQuery: ProfileQueryService,
) {
    @GetMapping
    fun get(principal: Principal): ProfileResponse = ProfileResponse.from(profileQuery.get(principal.accountId()))
}

/** GET /me/profile 응답. */
data class ProfileResponse(
    val nickname: String,
    val nicknameUpdatedAt: Instant,
    val onboardingCompletedAt: Instant?,
) {
    companion object {
        fun from(p: Profile) = ProfileResponse(p.nickname, p.nicknameUpdatedAt, p.onboardingCompletedAt)
    }
}
