package com.trippilot.auth.adapter.out.external

import com.trippilot.auth.domain.Provider
import com.trippilot.auth.domain.SocialProfile

/**
 * 제공자별 OAuth 클라이언트 — "1 외부API = 1 어댑터"(architecture.md).
 * 서버측에서 authorization code 를 교환하고 제공자 신원(sub·email)을 취득한다.
 */
interface OAuthProviderClient {
    val provider: Provider

    fun fetchProfile(authorizationCode: String, codeVerifier: String, redirectUri: String): SocialProfile
}
