package com.trippilot.auth.adapter.out.external

import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.ObjectMapper
import com.trippilot.auth.domain.SocialProfile
import org.springframework.http.MediaType
import org.springframework.util.LinkedMultiValueMap
import org.springframework.web.client.RestClient

/** 외부 응답 파싱용 ObjectMapper(빈 의존 없이 모듈 내부 공유 — MVC 설정과 디커플). */
internal val OAUTH_JSON: ObjectMapper = ObjectMapper()

/**
 * OAuth2 authorization-code 흐름 공통 골격 — code→token→userinfo.
 * 제공자별 endpoint 설정([config])과 userinfo 파싱([parseProfile])만 하위가 구현한다.
 * (Google·Kakao·Naver 공통. Apple 은 id_token 기반이라 별도.)
 *
 * TODO(SECURITY, IdP 등록 후): id_token 서명 검증(JWKS)·nonce·state 검증 추가.
 */
abstract class AbstractOAuth2Client(
    restClientBuilder: RestClient.Builder,
) : OAuthProviderClient {

    protected val restClient: RestClient = restClientBuilder.build()

    protected abstract fun config(): SocialProviderProperties.ProviderConfig

    protected abstract fun parseProfile(userInfo: JsonNode): SocialProfile

    override fun fetchProfile(authorizationCode: String, codeVerifier: String, redirectUri: String): SocialProfile {
        val cfg = config()
        val accessToken = requestAccessToken(cfg, authorizationCode, codeVerifier, redirectUri)
        return parseProfile(requestUserInfo(cfg, accessToken))
    }

    private fun requestAccessToken(
        cfg: SocialProviderProperties.ProviderConfig,
        code: String,
        codeVerifier: String,
        redirectUri: String,
    ): String {
        val form = LinkedMultiValueMap<String, String>().apply {
            add("grant_type", "authorization_code")
            add("code", code)
            add("redirect_uri", redirectUri)
            add("client_id", cfg.clientId)
            add("client_secret", cfg.clientSecret)
            add("code_verifier", codeVerifier)
        }
        val body = restClient.post()
            .uri(cfg.tokenUri)
            .contentType(MediaType.APPLICATION_FORM_URLENCODED)
            .body(form)
            .retrieve()
            .body(String::class.java) ?: error("빈 토큰 응답")
        return OAUTH_JSON.readTree(body).text("access_token") ?: error("access_token 없음")
    }

    private fun requestUserInfo(cfg: SocialProviderProperties.ProviderConfig, accessToken: String): JsonNode {
        val body = restClient.get()
            .uri(cfg.userInfoUri)
            .header("Authorization", "Bearer $accessToken")
            .retrieve()
            .body(String::class.java) ?: error("빈 userinfo 응답")
        return OAUTH_JSON.readTree(body)
    }
}

/** JsonNode 필드 → nullable String(null·MissingNode 처리). */
internal fun JsonNode.text(field: String): String? =
    get(field)?.takeIf { !it.isNull }?.asText()
