package com.trippilot.auth.domain

/**
 * 액세스 + 리프레시 토큰 쌍(값 객체). 발급 상세(RS256·회전)는 TokenIssuer 구현이 소유(TRIP-153).
 */
data class TokenPair(
    val accessToken: String,
    val refreshToken: String,
)
