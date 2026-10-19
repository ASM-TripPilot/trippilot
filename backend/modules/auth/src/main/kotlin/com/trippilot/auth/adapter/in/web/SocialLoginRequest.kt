package com.trippilot.auth.adapter.`in`.web

import com.trippilot.auth.application.SocialLoginCommand
import com.trippilot.auth.domain.AgeMethod
import com.trippilot.auth.domain.Provider
import jakarta.validation.constraints.NotBlank
import jakarta.validation.constraints.Size
import java.time.LocalDate
import java.util.UUID

/**
 * 소셜 로그인 요청. `ageConfirmation` 은 신규 가입 시 필수(기존 로그인 시 무시).
 * `deviceId` 는 리프레시 세션의 소유 기기 — 미제공 시 서버가 임의값을 부여(기기별 세션 분리).
 */
data class SocialLoginRequest(
    @field:NotBlank
    val authorizationCode: String,
    @field:NotBlank
    val codeVerifier: String,
    @field:NotBlank
    val redirectUri: String,
    val ageConfirmation: AgeConfirmation? = null,
    // 세션 컬럼(auth_session.device_id varchar(128))과 같은 상한 — 여기서 막지 않으면 저장에서 22001 → 500.
    @field:Size(max = 128, message = "deviceId 는 128자 이하입니다.")
    val deviceId: String? = null,
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
        deviceId = deviceId?.takeIf { it.isNotBlank() } ?: UUID.randomUUID().toString(),
    )
}
