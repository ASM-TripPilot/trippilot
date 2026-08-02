package com.trippilot.auth.adapter.`in`.web

import com.trippilot.auth.application.SocialTokenLoginCommand
import com.trippilot.auth.domain.Provider
import jakarta.validation.constraints.NotBlank
import java.util.UUID

/**
 * 네이티브 SDK 토큰 로그인 요청 — 앱이 카카오·네이버 SDK로 받은 access token 전달.
 * `ageConfirmation`·`deviceId` 규칙은 code 흐름([SocialLoginRequest])과 동일.
 */
data class SocialTokenLoginRequest(
    @field:NotBlank
    val accessToken: String,
    val ageConfirmation: SocialLoginRequest.AgeConfirmation? = null,
    val deviceId: String? = null,
) {
    fun toCommand(provider: Provider): SocialTokenLoginCommand = SocialTokenLoginCommand(
        provider = provider,
        accessToken = accessToken,
        ageMethod = ageConfirmation?.method,
        birthDate = ageConfirmation?.birthDate,
        deviceId = deviceId?.takeIf { it.isNotBlank() } ?: UUID.randomUUID().toString(),
    )
}
