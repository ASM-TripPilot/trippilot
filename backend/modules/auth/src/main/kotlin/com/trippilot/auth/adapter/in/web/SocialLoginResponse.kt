package com.trippilot.auth.adapter.`in`.web

/** 소셜 로그인 응답(TokenPair + isNewUser). 성공은 래퍼 없이 본문 그대로. */
data class SocialLoginResponse(
    val accessToken: String,
    val refreshToken: String,
    val isNewUser: Boolean,
)
