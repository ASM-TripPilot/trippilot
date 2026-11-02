package com.trippilot.auth.adapter.out.external

import com.fasterxml.jackson.databind.JsonNode
import com.trippilot.auth.domain.Provider
import com.trippilot.auth.domain.SocialProfile
import com.trippilot.core.error.AuthenticationRequired
import com.trippilot.core.error.ErrorCode
import org.slf4j.LoggerFactory
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

    /** 웹 클라이언트로 교환해도 되는 redirectUri — 허용 웹 출처마다 정확히 `<출처>/oauth/google` 하나. */
    private val webRedirectUris: Set<String> = webRedirectUris(props.googleWeb.redirectOrigins)

    /**
     * **redirectUri 로 클라이언트를 고른다**(TRIP-1656). 구글은 code 를 발급한 클라이언트로만 교환해 준다 — 웹에서 받은
     * code 를 iOS 클라이언트 ID 로 교환하면 거절되고, 그 반대도 같다.
     *
     * - http(s) 가 아닌 redirect(앱의 커스텀 스킴) → 지금처럼 iOS 클라이언트([config]).
     * - http(s) redirect 는 **허용 목록과 정확히 같을 때만** 웹 클라이언트. 목록 밖이면 교환하지 않고 401 이다 —
     *   웹 클라이언트는 시크릿을 붙여 교환하므로, 아무 웹 주소나 받으면 남의 사이트가 연 인가 요청의 code 를 우리 시크릿으로
     *   바꿔 주는 길이 된다(열린 redirect). 웹 이전에도 이 경우는 iOS 클라이언트로 보내 구글이 거절했으니(401) 결과는 같고
     *   아웃바운드만 줄었다.
     * - 웹 클라이언트 미설정은 401 로 둔다 — 티켓(TRIP-1656) 권고 "지금처럼 401". 미설정을 501 로 가르는 다른 제공자와 다른
     *   이유: iOS 앱의 구글 로그인은 설정돼 있어 "구글 로그인이 준비 중"이라는 답이 사실이 아니다.
     *
     * 거절 사유는 로그에만 남기고 응답에 싣지 않는다(SECURITY-15). redirectUri 는 시크릿이 아니다.
     */
    override fun exchangeConfig(redirectUri: String): SocialProviderProperties.ProviderConfig {
        val scheme = redirectUri.substringBefore("://", missingDelimiterValue = "").lowercase()
        if (scheme != "http" && scheme != "https") return config()
        if (redirectUri !in webRedirectUris) {
            log.warn("구글 웹 redirectUri 가 허용 목록에 없어 교환하지 않습니다: {}", redirectUri)
            throw AuthenticationRequired("소셜 인증에 실패했습니다.", ErrorCode.SOCIAL_AUTH_FAILED)
        }
        val web = props.googleWeb
        if (web.clientId.isBlank()) {
            log.warn("GOOGLE_WEB_CLIENT_ID 가 비어 구글 웹 로그인을 교환하지 않습니다.")
            throw AuthenticationRequired("소셜 인증에 실패했습니다.", ErrorCode.SOCIAL_AUTH_FAILED)
        }
        return web
    }

    override fun parseProfile(userInfo: JsonNode) = SocialProfile(
        provider = Provider.GOOGLE,
        providerSub = userInfo.text("sub") ?: error("google sub 없음"),
        email = userInfo.text("email"),
    )

    internal companion object {
        private val log = LoggerFactory.getLogger(GoogleOAuthClient::class.java)
        private val LOOPBACK = Regex("""^http://(localhost|127\.0\.0\.1)(:\d+)?$""")

        /**
         * 허용 출처(쉼표 구분) → 웹 redirectUri 집합. https 출처만 받고, http 는 로컬 개발용 루프백(localhost·127.0.0.1)만
         * 받는다 — 구글도 웹 클라이언트 redirect 에 http 는 localhost 만 허용한다. 끝 `/` 는 떼고 붙인다.
         */
        internal fun webRedirectUris(origins: String): Set<String> =
            origins.split(',').map { it.trim().trimEnd('/') }
                .filter { it.startsWith("https://") || LOOPBACK.matches(it) }
                .map { "$it/oauth/google" }
                .toSet()
    }
}

/** Kakao OIDC — userinfo `{id, kakao_account:{email}}`. */
@Component
class KakaoOAuthClient(
    private val props: SocialProviderProperties,
    restClientBuilder: RestClient.Builder,
) : AbstractOAuth2Client(restClientBuilder) {
    override val provider = Provider.KAKAO
    override fun config() = props.kakao

    init {
        // 조용히 꺼져 있으면 "막았다"고 믿게 된다 — 미주입은 기동 로그에 남긴다.
        if (props.kakao.appId.isBlank()) {
            log.warn("KAKAO_APP_ID 가 비어 카카오 SDK 토큰의 발급 앱을 대조하지 않습니다 — 남의 앱 토큰으로 가입이 열려 있습니다(TRIP-1317).")
        }
    }

    /**
     * **우리 앱에 발급된 토큰만 받는다**(TRIP-1317). userinfo 는 "이 사람이 누구인가"만 답하므로, 남의 카카오
     * 앱이 받은 토큰도 그대로 통과해 그 토큰의 이메일로 계정이 만들어졌다 — 본인의 첫 가입이 409 로 막힌다.
     * `access_token_info` 의 `app_id` 가 그 토큰의 발급 앱이다.
     *
     * 거절은 401(`SOCIAL_AUTH_FAILED`)이고 응답에 사유는 싣지 않는다(SECURITY-15) — 로그에만 남긴다.
     * 조회 자체의 실패는 userinfo 호출과 같은 길로 [SocialAuthAdapter] 가 가른다: 4xx 는 401, 5xx·타임아웃은
     * 503. 카카오는 일시 내부 장애(-1)도 HTTP 400 으로 답하므로 그 경우는 401 로 나간다(userinfo 도 같다).
     */
    override fun fetchProfileByAccessToken(accessToken: String): SocialProfile {
        val cfg = config()
        if (cfg.appId.isNotBlank()) {
            val body = restClient.get()
                .uri(cfg.tokenInfoUri)
                .header("Authorization", "Bearer $accessToken")
                .retrieve()
                .body(String::class.java) ?: error("빈 토큰 정보 응답")
            val issuedTo = OAUTH_JSON.readTree(body).text("app_id")
            if (issuedTo != cfg.appId.trim()) {
                // 응답에는 사유를 싣지 않으므로 여기 남긴다 — 없으면 앱 ID 를 잘못 넣은 환경(모든 카카오 로그인이
                // 401)과 만료 토큰을 로그로도 못 가른다. 앱 ID 는 시크릿이 아니다.
                log.warn("카카오 토큰의 발급 앱이 우리 앱이 아니라 거절합니다. 기대={} 실제={}", cfg.appId.trim(), issuedTo)
                throw AuthenticationRequired("소셜 인증에 실패했습니다.", ErrorCode.SOCIAL_AUTH_FAILED)
            }
        }
        return super.fetchProfileByAccessToken(accessToken)
    }

    private companion object {
        val log = LoggerFactory.getLogger(KakaoOAuthClient::class.java)
    }
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
