package com.trippilot.auth.application

/**
 * 소셜 로그인 결과 — 액세스 토큰(RS256 JWT) + 리프레시 토큰(원문) + 신규 가입 여부.
 * 리프레시 원문은 응답으로 1회 전달된 뒤 서버에 남지 않는다(해시만 보관).
 */
data class SocialLoginResult(
    val accessToken: String,
    val refreshToken: String,
    val isNewUser: Boolean,
)
