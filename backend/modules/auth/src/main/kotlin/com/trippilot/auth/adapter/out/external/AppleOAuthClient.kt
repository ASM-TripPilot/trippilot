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
 * ⚠️ 현재 **fail-closed**: id_token 서명검증(JWKS)·aud/iss/exp 미구현이라 Apple 로그인은 비활성.
 * 무검증 id_token 을 신뢰하면 위조 sub 로 임의 계정 탈취가 가능하다(sub 가 계정 식별키).
 *
 * TODO(SECURITY, IdP 등록 후):
 *  1) client_secret 을 p8 키로 ES256 JWT 동적 서명 생성.
 *  2) id_token 서명 검증(Apple JWKS)·aud·iss·exp 검증.
 *  3) 검증 완료 후 fetchProfile 에서 exchangeAndDecodeUnverified 를 호출하도록 복원.
 */
@Component
class AppleOAuthClient(
    private val props: SocialProviderProperties,
    restClientBuilder: RestClient.Builder,
) : OAuthProviderClient {

    override val provider = Provider.APPLE
    private val restClient = restClientBuilder.build()

    override fun fetchProfile(authorizationCode: String, codeVerifier: String, redirectUri: String): SocialProfile {
        throw UnsupportedOperationException(
            "Apple 로그인은 id_token 서명검증(JWKS) 구현 전까지 비활성화되어 있습니다",
        )
    }

    override fun fetchProfileByAccessToken(accessToken: String): SocialProfile {
        // Apple 은 userinfo 엔드포인트가 없다(신원은 id_token 안에) — access token 흐름 미지원.
        throw UnsupportedOperationException("Apple 은 access token userinfo 흐름을 지원하지 않습니다")
    }

    /** 토큰 교환 + id_token 파싱(무검증). JWKS 서명검증 추가 전까지 미사용(fail-closed). */
    @Suppress("unused")
    private fun exchangeAndDecodeUnverified(
        authorizationCode: String,
        codeVerifier: String,
        redirectUri: String,
    ): SocialProfile {
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
            .body(String::class.java) ?: error("빈 토큰 응답")

        val idToken = OAUTH_JSON.readTree(token).text("id_token") ?: error("id_token 없음")
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
