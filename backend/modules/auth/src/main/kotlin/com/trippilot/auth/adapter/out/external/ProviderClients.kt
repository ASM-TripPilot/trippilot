package com.trippilot.auth.adapter.out.external

import com.fasterxml.jackson.databind.JsonNode
import com.trippilot.auth.domain.Provider
import com.trippilot.auth.domain.SocialProfile
import org.springframework.stereotype.Component
import org.springframework.web.client.RestClient

/** Google OIDC — userinfo `{sub, email}`. */
@Component
class GoogleOAuthClient(
    private val props: SocialProviderProperties,
    restClientBuilder: RestClient.Builder,
) : AbstractOAuth2Client(restClientBuilder) {
    override val provider = Provider.GOOGLE
    override fun config() = props.google
    override fun parseProfile(userInfo: JsonNode) = SocialProfile(
        provider = Provider.GOOGLE,
        providerSub = userInfo.text("sub") ?: error("google sub 없음"),
        email = userInfo.text("email"),
    )
}

/** Kakao OIDC — userinfo `{id, kakao_account:{email}}`. */
@Component
class KakaoOAuthClient(
    private val props: SocialProviderProperties,
    restClientBuilder: RestClient.Builder,
) : AbstractOAuth2Client(restClientBuilder) {
    override val provider = Provider.KAKAO
    override fun config() = props.kakao
    override fun parseProfile(userInfo: JsonNode) = SocialProfile(
        provider = Provider.KAKAO,
        providerSub = userInfo.text("id") ?: error("kakao id 없음"),
        email = userInfo.get("kakao_account")?.text("email"),
    )
}

/** Naver OAuth2 — 프로필 API `{response:{id, email}}` (OIDC 미지원). */
@Component
class NaverOAuthClient(
    private val props: SocialProviderProperties,
    restClientBuilder: RestClient.Builder,
) : AbstractOAuth2Client(restClientBuilder) {
    override val provider = Provider.NAVER
    override fun config() = props.naver
    override fun parseProfile(userInfo: JsonNode): SocialProfile {
        val response = userInfo.get("response") ?: error("naver response 없음")
        return SocialProfile(
            provider = Provider.NAVER,
            providerSub = response.text("id") ?: error("naver id 없음"),
            email = response.text("email"),
        )
    }
}
