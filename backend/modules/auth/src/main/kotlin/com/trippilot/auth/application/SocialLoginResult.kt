package com.trippilot.auth.application

import com.trippilot.auth.domain.TokenPair

/** 소셜 로그인 결과 — 토큰 쌍 + 신규 가입 여부(응답 `isNewUser`). */
data class SocialLoginResult(
    val tokens: TokenPair,
    val isNewUser: Boolean,
)
