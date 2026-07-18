package com.trippilot.auth.adapter.`in`.web

import com.trippilot.auth.application.SocialLoginCommand
import com.trippilot.auth.domain.AgeMethod
import com.trippilot.auth.domain.Provider
import jakarta.validation.constraints.NotBlank
import java.time.LocalDate

/**
 * 소셜 로그인 요청. `ageConfirmation` 은 신규 가입 시 필수(기존 로그인 시 무시).
 */
data class SocialLoginRequest(
    @field:NotBlank
    val authorizationCode: String,
    @field:NotBlank
    val codeVerifier: String,
    @field:NotBlank
    val redirectUri: String,
    val ageConfirmation: AgeConfirmation? = null,
) {
    data class AgeConfirmation(
        val method: AgeMethod,
        val birthDate: LocalDate? = null,
    )

    fun toCommand(provider: Provider): SocialLoginCommand = SocialLoginCommand(
        provider = provider,
        authorizationCode = authorizationCode,
        codeVerifier = codeVerifier,
        redirectUri = redirectUri,
        ageMethod = ageConfirmation?.method,
        birthDate = ageConfirmation?.birthDate,
    )
}
