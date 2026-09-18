package com.trippilot.auth.application

/**
 * 소셜 로그인 결과 — 액세스 토큰(RS256 JWT) + 리프레시 토큰(원문) + 각 만료(초) + 신규 가입 여부 + 계정 요약.
 * 리프레시 원문은 응답으로 1회 전달된 뒤 서버에 남지 않는다(해시만 보관).
 *
 * `tokenType` 은 여기 없다 — 와이어 상수("Bearer")라 웹 어댑터가 소유한다.
 */
data class SocialLoginResult(
    val accessToken: String,
    val expiresIn: Long,
    val refreshToken: String,
    val refreshExpiresIn: Long,
    val isNewUser: Boolean,
    val account: AccountSummary,
)
