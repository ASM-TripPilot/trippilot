package com.trippilot.auth.adapter.out.external

import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.ObjectMapper
import com.trippilot.auth.domain.Provider
import com.trippilot.auth.domain.SocialProfile
import com.trippilot.core.error.ProviderNotSupported
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
        val cfg = requireConfigured()
        val accessToken = requestAccessToken(cfg, authorizationCode, codeVerifier, redirectUri)
        return parseProfile(requestUserInfo(cfg, accessToken))
    }

    /**
     * SDK 발급 토큰 흐름 — 교환 없이 userinfo 만 호출한다.
     *
     * **여기엔 미설정 가드가 없다.** 이 경로는 `clientId` 를 쓰지 않기 때문이다 — 소유증명은 앱이
     * 네이티브 SDK 에서 이미 받아 온 토큰이 하고, 서버는 그것으로 userinfo 만 묻는다. 실제로
     * `GoogleOAuthClientTest` 가 `userInfoUri` 만 채운 설정으로 이 경로를 검증한다. 키 미발급은
     * 이 경로에서 **앱 쪽이 먼저 막는다**(SDK 초기화가 안 된다).
     */
    override fun fetchProfileByAccessToken(accessToken: String): SocialProfile =
        parseProfile(requestUserInfo(config(), accessToken))

    /**
     * **미설정은 인증 실패가 아니다** — Apple 이 이미 그렇게 가르고 있고(`AppleOAuthClient`), 같은 논리가
     * 나머지 3사에도 그대로 적용된다(TRIP-249).
     *
     * `clientId` 가 비면 종전에는 **빈 client_id 로 IdP 를 실제로 호출**했고, 제공자의 4xx 를
     * `SocialAuthAdapter` 가 401 `SOCIAL_AUTH_FAILED` 로 일반화했다. 그러면 앱이 "다시 시도"를 권하고
     * 사용자는 같은 실패를 반복한다 — 재시도로 풀리지 않는 상태다. 덤으로 시도할 때마다 쓸모없는
     * 아웃바운드가 나간다.
     *
     * `tokenUri`·`userInfoUri` 는 보지 않는다 — 그쪽은 env 가 아니라 `application.yml` 상수라
     * 미주입이라는 상태가 없다. 실제로 비는 것은 발급받아 주입하는 `clientId` 뿐이다.
     *
     * **교환 흐름에서만 부른다.** SDK 토큰 흐름은 `clientId` 를 쓰지 않으므로 여기서 막으면
     * 정상 경로를 막게 된다(기존 테스트가 그 사실을 이미 고정해 두고 있었다).
     */
    private fun requireConfigured(): SocialProviderProperties.ProviderConfig {
        val cfg = config()
        if (cfg.clientId.isBlank()) {
            // 노출하는 것은 가용성뿐 — 왜 미지원인지(키 미발급 등)는 싣지 않는다(SECURITY-15).
            throw ProviderNotSupported("${provider.displayName} 로그인은 아직 준비 중이에요.")
        }
        return cfg
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
            // public 클라이언트(예: Google iOS)는 client_secret 이 없다 — 설정됐을 때만 전송, 소유증명은 PKCE(code_verifier).
            if (cfg.clientSecret.isNotBlank()) add("client_secret", cfg.clientSecret)
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

/**
 * 사용자에게 보여 줄 제공자 이름. **도메인 enum 에 두지 않는다** — 화면 문구는 표현의 문제고,
 * 그것 때문에 도메인이 언어를 알게 되면 다국어가 생기는 날 도메인부터 고쳐야 한다.
 */
internal val Provider.displayName: String
    get() = when (this) {
        Provider.GOOGLE -> "구글"
        Provider.KAKAO -> "카카오"
        Provider.NAVER -> "네이버"
        Provider.APPLE -> "애플"
    }
