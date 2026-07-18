package com.trippilot.auth.adapter.out.external

import com.fasterxml.jackson.databind.JsonNode
import com.trippilot.auth.domain.Provider
import com.trippilot.auth.domain.SocialProfile
import org.springframework.http.MediaType
import org.springframework.stereotype.Component
import org.springframework.util.LinkedMultiValueMap
import org.springframework.web.client.RestClient
import java.util.Base64

/**
 * Apple — 토큰 응답의 id_token(JWT) 에서 sub·email 취득(userinfo 엔드포인트 없음).
 *
 * TODO(SECURITY, IdP 등록 후):
 *  1) client_secret 을 p8 키로 ES256 JWT 동적 서명 생성(현재 props.apple.clientSecret 사전값 사용).
 *  2) id_token 서명 검증(Apple JWKS)·aud·iss·exp 검증.
 */
@Component
class AppleOAuthClient(
    private val props: SocialProviderProperties,
    restClientBuilder: RestClient.Builder,
) : OAuthProviderClient {

    override val provider = Provider.APPLE
    private val restClient = restClientBuilder.build()

    override fun fetchProfile(authorizationCode: String, codeVerifier: String, redirectUri: String): SocialProfile {
        val cfg = props.apple
        val form = LinkedMultiValueMap<String, String>().apply {
            add("grant_type", "authorization_code")
            add("code", authorizationCode)
            add("redirect_uri", redirectUri)
            add("client_id", cfg.clientId)
            add("client_secret", cfg.clientSecret)
            add("code_verifier", codeVerifier)
        }
        val token = restClient.post()
            .uri(cfg.tokenUri)
            .contentType(MediaType.APPLICATION_FORM_URLENCODED)
            .body(form)
            .retrieve()
            .body(JsonNode::class.java) ?: error("빈 토큰 응답")

        val idToken = token.text("id_token") ?: error("id_token 없음")
        val payload = decodePayload(idToken)
        return SocialProfile(
            provider = Provider.APPLE,
            providerSub = payload.text("sub") ?: error("apple sub 없음"),
            email = payload.text("email"),
        )
    }

    private fun decodePayload(jwt: String): JsonNode {
        val parts = jwt.split(".")
        require(parts.size >= 2) { "잘못된 id_token 형식" }
        val json = String(Base64.getUrlDecoder().decode(parts[1]))
        return OAUTH_JSON.readTree(json)
    }
}
