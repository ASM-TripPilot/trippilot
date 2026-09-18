package com.trippilot.auth.application

import com.trippilot.auth.domain.AgeMethod
import com.trippilot.auth.domain.Provider
import java.time.LocalDate

/**
 * 소셜 로그인/가입 요청 커맨드. `ageMethod`·`birthDate` 는 신규 가입 시에만 사용(기존 로그인 시 무시).
 * `deviceId` 는 리프레시 세션(회전 체인)의 소유 기기 식별자 — 미제공 시 웹 계층이 임의값을 부여한다.
 */
data class SocialLoginCommand(
    val provider: Provider,
    val authorizationCode: String,
    val codeVerifier: String,
    val redirectUri: String,
    val ageMethod: AgeMethod?,
    val birthDate: LocalDate?,
    val deviceId: String,
)
