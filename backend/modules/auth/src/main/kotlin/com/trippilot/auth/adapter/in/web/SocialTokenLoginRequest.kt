package com.trippilot.auth.adapter.`in`.web

import com.trippilot.auth.application.SocialTokenLoginCommand
import com.trippilot.auth.domain.Provider
import jakarta.validation.constraints.NotBlank
import jakarta.validation.constraints.Size
import java.util.UUID

/**
 * 네이티브 SDK 토큰 로그인 요청 — 앱이 카카오·네이버 SDK로 받은 access token 전달.
 * `ageConfirmation`·`deviceId` 규칙은 code 흐름([SocialLoginRequest])과 동일.
 */
data class SocialTokenLoginRequest(
    @field:NotBlank
    val accessToken: String,
    val ageConfirmation: SocialLoginRequest.AgeConfirmation? = null,
    // 세션 컬럼(refresh_session.device_id varchar(128))과 같은 상한 — 여기서 막지 않으면 저장에서 22001 → 500.
    @field:Size(max = 128, message = "deviceId 는 128자 이하입니다.")
    val deviceId: String? = null,
    /**
     * 선택 — **애플만** 쓴다(TRIP-933). 로그인은 [accessToken](identityToken)으로 끝나고, 이 code 는 계정
     * 파기 때 Apple 토큰을 revoke 하기 위한 refresh_token 교환에만 쓴다. 다른 제공자는 무시한다.
     */
    val authorizationCode: String? = null,
) {
    fun toCommand(provider: Provider): SocialTokenLoginCommand = SocialTokenLoginCommand(
        provider = provider,
        accessToken = accessToken,
        ageMethod = ageConfirmation?.method,
        birthDate = ageConfirmation?.birthDate,
        deviceId = deviceId?.takeIf { it.isNotBlank() } ?: UUID.randomUUID().toString(),
        authorizationCode = authorizationCode?.takeIf { it.isNotBlank() },
    )
}
