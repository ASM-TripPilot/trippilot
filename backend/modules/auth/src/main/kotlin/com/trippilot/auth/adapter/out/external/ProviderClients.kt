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
