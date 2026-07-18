package com.trippilot.auth.application

import com.trippilot.auth.domain.AgeMethod
import com.trippilot.auth.domain.Provider
import java.time.LocalDate

/**
 * 소셜 로그인/가입 요청 커맨드. `ageMethod`·`birthDate` 는 신규 가입 시에만 사용(기존 로그인 시 무시).
 */
data class SocialLoginCommand(
    val provider: Provider,
    val authorizationCode: String,
    val codeVerifier: String,
    val redirectUri: String,
    val ageMethod: AgeMethod,
    val birthDate: LocalDate?,
)
