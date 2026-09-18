package com.trippilot.auth.adapter.`in`.web

import com.trippilot.auth.application.SocialLoginResult

/**
 * 소셜 로그인 응답(계약의 TokenPair). 성공은 래퍼 없이 본문 그대로.
 *
 * 전에는 세 필드(accessToken·refreshToken·isNewUser)만 나갔다. 계약이 선언한 만료·계정 요약이
 * 비어 있어 앱은 만료를 모른 채 401 을 받고서야 갱신했고, 로그인 직후 계정 상태를 알려면
 * `/me` 를 한 번 더 호출해야 했다(TRIP-249 5번).
 */
data class SocialLoginResponse(
    val accessToken: String,
    val tokenType: String,
    val expiresIn: Long,
    val refreshToken: String,
    val refreshExpiresIn: Long,
    val isNewUser: Boolean,
    val account: AccountSummaryResponse,
) {
    companion object {
        fun from(result: SocialLoginResult) = SocialLoginResponse(
            accessToken = result.accessToken,
            tokenType = BEARER,
            expiresIn = result.expiresIn,
            refreshToken = result.refreshToken,
            refreshExpiresIn = result.refreshExpiresIn,
            isNewUser = result.isNewUser,
            account = AccountSummaryResponse.from(result.account),
        )
    }
}

/** 토큰 스킴 — 계약 고정값. 클라는 `Authorization: Bearer <accessToken>` 으로 조립한다. */
const val BEARER = "Bearer"
