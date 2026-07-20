package com.trippilot.auth.domain.port

import com.trippilot.auth.domain.Provider
import com.trippilot.auth.domain.SocialProfile

/**
 * 소셜 제공자 인증 포트 — "1 외부API = 1 어댑터 포트"(architecture.md).
 * 서버측에서 authorization code 를 토큰으로 교환하고 제공자 신원(sub·email)을 취득한다(시크릿 비노출).
 * 구현: adapter/out/external 의 제공자별 어댑터(Google·Kakao·Naver·Apple). 실패 시 SOCIAL_AUTH_FAILED.
 */
interface SocialAuthPort {
    fun exchange(
        provider: Provider,
        authorizationCode: String,
        codeVerifier: String,
        redirectUri: String,
    ): SocialProfile
}
