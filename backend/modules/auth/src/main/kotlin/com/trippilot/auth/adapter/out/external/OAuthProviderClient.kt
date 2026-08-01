package com.trippilot.auth.adapter.out.external

import com.trippilot.auth.domain.Provider
import com.trippilot.auth.domain.SocialProfile

/**
 * 제공자별 OAuth 클라이언트 — "1 외부API = 1 어댑터"(architecture.md).
 * 서버측에서 authorization code 를 교환하고 제공자 신원(sub·email)을 취득한다.
 */
interface OAuthProviderClient {
    val provider: Provider

    /** 서버측 code→token 교환 흐름(웹·커스텀 스킴 redirect). */
    fun fetchProfile(authorizationCode: String, codeVerifier: String, redirectUri: String): SocialProfile

    /** 네이티브 SDK(카카오·네이버 등)가 발급한 access token 으로 userinfo 직접 취득(교환 생략). */
    fun fetchProfileByAccessToken(accessToken: String): SocialProfile
}
