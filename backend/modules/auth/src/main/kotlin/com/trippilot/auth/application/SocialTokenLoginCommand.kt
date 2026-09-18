package com.trippilot.auth.application

import com.trippilot.auth.domain.AgeMethod
import com.trippilot.auth.domain.Provider
import java.time.LocalDate

/**
 * 네이티브 SDK 토큰 로그인/가입 커맨드 — 앱이 SDK로 받은 access token 을 그대로 전달.
 * code 교환([SocialLoginCommand])과 이후 처리(계정 upsert·토큰 발급)는 동일. 카카오·네이버 SDK 경로.
 */
data class SocialTokenLoginCommand(
    val provider: Provider,
    val accessToken: String,
    val ageMethod: AgeMethod?,
    val birthDate: LocalDate?,
    val deviceId: String,
)
