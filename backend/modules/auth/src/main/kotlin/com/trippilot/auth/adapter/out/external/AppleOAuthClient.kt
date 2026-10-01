package com.trippilot.auth.adapter.out.external

import com.trippilot.auth.domain.Provider
import com.trippilot.auth.domain.SocialProfile
import com.trippilot.auth.domain.port.ProviderTokenRevocationPort
import com.trippilot.core.error.ProviderNotSupported
import com.trippilot.core.error.UpstreamUnavailable
import org.slf4j.LoggerFactory
import org.springframework.http.MediaType
import org.springframework.security.oauth2.core.DelegatingOAuth2TokenValidator
import org.springframework.security.oauth2.jwt.BadJwtException
import org.springframework.security.oauth2.jwt.Jwt
import org.springframework.security.oauth2.jwt.JwtClaimNames
import org.springframework.security.oauth2.jwt.JwtClaimValidator
import org.springframework.security.oauth2.jwt.JwtDecoder
import org.springframework.security.oauth2.jwt.JwtException
import org.springframework.security.oauth2.jwt.JwtIssuerValidator
import org.springframework.security.oauth2.jwt.JwtTimestampValidator
import org.springframework.security.oauth2.jwt.NimbusJwtDecoder
import org.springframework.stereotype.Component
import org.springframework.util.LinkedMultiValueMap
import org.springframework.web.client.RestClient
import org.springframework.web.client.RestTemplate
import java.time.Instant

/**
 * Apple — 신원은 `id_token`(JWT) 안에 있다. **userinfo 엔드포인트가 없다.**
 *
 * 그래서 이 어댑터는 나머지 3사와 흐름이 다르다. Google·Kakao·Naver 는 토큰으로 userinfo 를 불러
 * 제공자에게 "이 사람 누구냐"를 되묻지만, Apple 은 되물을 곳이 없어 **토큰의 서명을 우리가 직접 검증**한다.
 *
 * ## 무엇을 검증하는가 (전부 필요하다)
 *
 * - **서명**(Apple JWKS) — 없으면 누구나 `sub` 를 지어내 **남의 계정으로 로그인**한다. `sub` 가 계정 식별키다.
 * - **`aud`** — 없으면 **다른 애플 앱 개발자가 자기 앱의 id_token 으로 우리 계정에 들어온다.** Apple 은
 *   자기 고객 모두에게 유효한 서명을 발급하므로 서명만 보는 것은 검증이 아니다.
 * - **`iss`·`exp`** — 발급자·수명.
 *
 * ## 미설정은 401 이 아니라 501 이다 (TRIP-249)
 *
 * Apple 설정이 안 주입된 환경에서는 `ProviderNotSupported`(501) 로 나간다. 401 로 뭉개면 앱이
 * "다시 시도"를 권하고 사용자는 같은 실패를 반복한다 — 재시도로 풀리지 않는 상태다.
 *
 * ## 정본 이탈 (U0 business-logic-model §1)
 *
 * 정본은 Apple 을 `AUTH_CODE`(브라우저 OAuth) 경로로 적었으나, **`SDK_TOKEN` 경로로 간다**.
 * iOS 네이티브(`expo-apple-authentication`)가 `identityToken` 을 바로 주므로 code 교환 단계가 없고,
 * 교환에만 필요한 p8 ES256 `client_secret` 서명이 통째로 빠진다. 정본의 `SDK_TOKEN` 설명("사용자 조회
 * API 로 검증")과도 한 군데 다르다 — Apple 은 조회 API 가 없어 **서명 검증으로 대신한다**.
 * code 교환은 계정 파기 시 토큰 revoke 를 위해서만 한다(TRIP-933, [exchangeRevocationToken]).
 */
@Component
class AppleOAuthClient(
    private val props: SocialProviderProperties,
    restClientBuilder: RestClient.Builder,
    private val appleJwksRestTemplate: RestTemplate,
) : OAuthProviderClient, ProviderTokenRevocationPort {

    override val provider = Provider.APPLE
    private val restClient = restClientBuilder.build()

    /**
     * 첫 애플 로그인에서만 만들어진다 — Apple 미설정 환경에서 부팅이 깨지지 않게.
     *
     * JWKS 키 캐싱은 Nimbus 소관이라 **알려진 `kid` 는** 매 로그인마다 Apple 을 부르지 않는다.
     *
     * ponytail: **미지 `kid` 는 캐시를 뚫는다.** Spring 이 `JWKSourceBuilder` 를 `rateLimited(false)`
     * 로 짓고, Nimbus 는 selector 가 키를 못 찾으면 강제 재조회한다 — 매번 새 난수 `kid` 를 단 토큰을
     * 쏟아부으면 요청당 Apple 아웃바운드 GET 이 한 번씩 나간다(이 엔드포인트는 무인증이고 리포에
     * 레이트리미터 구현이 없다). 계정 탈취는 아니다(미지 kid 는 401 로 올바르게 막힌다) — **가용성**
     * 문제이고, Apple 이 egress 를 조이면 정상 사용자가 503 을 맞는다. 상한을 올리는 길은
     * `NimbusJwtDecoder` 에 `.cache(Cache)` 를 물리거나 애플 토큰 경로에 요청 상한을 거는 것. (TRIP-934)
     */
    private val decoder: JwtDecoder by lazy { buildDecoder() }

    override fun fetchProfile(authorizationCode: String, codeVerifier: String, redirectUri: String): SocialProfile {
        // 로그인은 아래 id_token 경로로만 간다. authorizationCode 는 revoke 용 토큰 확보에만 쓴다
        // ([exchangeRevocationToken], TRIP-933) — 웹 redirect 로그인은 앱에 없어 열지 않는다.
        throw ProviderNotSupported(NOT_READY)
    }

    /**
     * 앱이 Apple 네이티브 SDK 로 받은 **id_token**(`identityToken`)으로 신원을 확정한다.
     *
     * 파라미터 이름이 `accessToken` 인 것은 [OAuthProviderClient] 계약이 3사 기준으로 먼저 굳었기
     * 때문이고, **Apple 만 예외적으로 id_token 이 들어온다**(openapi 에 명시). 와이어를 바꾸면
     * 얻는 것이 이름뿐이라 그대로 둔다.
     */
    override fun fetchProfileByAccessToken(accessToken: String): SocialProfile {
        val jwt = decode(accessToken)
        return SocialProfile(
            provider = Provider.APPLE,
            // sub 는 Apple 팀 단위로 안정적이다(같은 사용자 = 같은 값).
            providerSub = jwt.subject ?: throw BadJwtException("apple sub 없음"),
            // 비공개 릴레이(@privaterelay.appleid.com)이거나 아예 없을 수 있다 — SocialProfile.email 이 nullable 인 이유.
            email = jwt.getClaimAsString("email"),
        )
    }

    private fun buildDecoder(): JwtDecoder {
        val cfg = props.apple
        return NimbusJwtDecoder.withJwkSetUri(cfg.jwksUri)
            .restOperations(appleJwksRestTemplate)
            .build()
            .apply {
                setJwtValidator(
                    DelegatingOAuth2TokenValidator(
                        JwtTimestampValidator(),
                        JwtIssuerValidator(cfg.issuer),
                        // aud 는 배열로 올 수 있다. 우리 번들 ID 가 그 안에 없으면 남의 앱 토큰이다.
                        JwtClaimValidator<List<String>?>(JwtClaimNames.AUD) { aud -> cfg.clientId in aud.orEmpty() },
                    ),
                )
            }
    }

    /**
     * 검증 실패와 조회 실패를 가른다 — **재시도로 풀리는가**가 기준이다.
     *
     * ponytail: nonce 미검증. 탈취된 id_token 재생 공격이 이론상 열려 있고, 막는 상한은 Apple 의
     * `exp`(10분)뿐이다. 서버 nonce 저장소를 세우면 닫히지만 지금 값이 안 나온다 — 재생 사례가
     * 관측되거나 심사에서 요구되면 그때 올린다.
     */
    private fun decode(idToken: String): Jwt {
        val cfg = props.apple
        if (cfg.clientId.isBlank() || cfg.jwksUri.isBlank() || cfg.issuer.isBlank()) {
            // IdP 미등록·미주입 — 자격 문제가 아니라 서버가 아직 그 기능을 안 하는 것이다.
            // 노출하는 것은 가용성뿐, 왜 미지원인지는 싣지 않는다(SECURITY-15).
            throw ProviderNotSupported(NOT_READY)
        }
        return try {
            decoder.decode(idToken)
        } catch (e: BadJwtException) {
            // 서명 위조·형식 오류, 그리고 aud·iss·exp 불일치(JwtValidationException 이 BadJwtException 이다).
            // 그대로 올리면 SocialAuthAdapter 가 401 SOCIAL_AUTH_FAILED 로 일반화한다 — 원인 비노출.
            throw e
        } catch (e: JwtException) {
            // 여기 남는 것은 JWKS 를 못 가져온 경우다. 사용자 자격 문제가 아니라 일시 장애다(RESILIENCY-10).
            throw UpstreamUnavailable(source = Provider.APPLE.name, fallbackApplied = false, cause = e)
        }
    }

    // ── revoke 용 토큰(TRIP-933) ──────────────────────────────────────────────────

    /**
     * 로그인 때 앱이 함께 보낸 `authorizationCode` 를 교환해 **refresh_token** 을 받는다 — 계정 파기 때
     * revoke 하기 위해서만이다. 로그인 자체는 위 id_token 경로에서 이미 끝났다.
     *
     * 교환 응답의 id_token 도 **JWKS 로 검증하고 `sub` 가 방금 로그인한 사람과 같은지 본다.** 안 보면
     * 자기 identityToken 에 남의 code 를 붙여 보내 남의 refresh_token 을 우리 계정에 걸 수 있다
     * (그 계정을 지우면 남의 애플 연결이 끊긴다). 종전 `exchangeAndDecodeUnverified` 의 무검증 파싱은 버렸다.
     *
     * 실패는 전부 null — 로그인을 막지 않는다([ProviderTokenRevocationPort] 참고). 원인은 예외 **종류**만
     * 남긴다: 응답 본문·요청 폼에는 code·client_secret 이 있다(SECURITY-15).
     */
    override fun exchangeRevocationToken(provider: Provider, authorizationCode: String, expectedSub: String): String? {
        if (provider != Provider.APPLE) return null
        if (!revocationConfigured()) {
            log.warn("Apple revoke 설정(Team ID·Key ID·p8)이 없어 authorizationCode 교환을 건너뜁니다 — 이 계정은 파기 때 revoke 되지 않습니다.")
            return null
        }
        return try {
            val cfg = props.apple
            val form = LinkedMultiValueMap<String, String>().apply {
                add("grant_type", "authorization_code")
                add("code", authorizationCode)
                add("client_id", cfg.clientId)
                add("client_secret", clientSecret.sign(Instant.now()))
            }
            val body = restClient.post()
                .uri(cfg.tokenUri)
                .contentType(MediaType.APPLICATION_FORM_URLENCODED)
                .body(form)
                .retrieve()
                .body(String::class.java) ?: error("빈 토큰 응답")
            val json = OAUTH_JSON.readTree(body)
            val idToken = json.text("id_token") ?: error("id_token 없음")
            if (decode(idToken).subject != expectedSub) {
                log.warn("Apple code 교환 결과의 sub 가 로그인한 사용자와 다릅니다 — 토큰을 버립니다.")
                return null
            }
            json.text("refresh_token")
        } catch (e: Exception) {
            log.warn("Apple authorizationCode 교환 실패({}) — 로그인은 진행합니다. 이 계정은 다음 로그인까지 revoke 대상이 없습니다.", e.javaClass.simpleName)
            null
        }
    }

    /**
     * `POST /auth/revoke` — 2xx 가 아니면 예외다. 호출자(파기 스위프)가 잡아 다음 회차에 다시 시도한다.
     * 예외 메시지에 요청 폼(client_secret·token)은 실리지 않는다 — RestClient 예외는 **응답** 상태·본문만 담는다.
     */
    override fun revoke(provider: Provider, token: String) {
        require(provider == Provider.APPLE) { "revoke 는 Apple 만 지원합니다: $provider" }
        check(revocationConfigured()) { "Apple revoke 설정(Team ID·Key ID·p8)이 없습니다." }
        val cfg = props.apple
        val form = LinkedMultiValueMap<String, String>().apply {
            add("client_id", cfg.clientId)
            add("client_secret", clientSecret.sign(Instant.now()))
            add("token", token)
            add("token_type_hint", "refresh_token")
        }
        restClient.post()
            .uri(cfg.revokeUri)
            .contentType(MediaType.APPLICATION_FORM_URLENCODED)
            .body(form)
            .retrieve()
            .toBodilessEntity()
    }

    private fun revocationConfigured(): Boolean = with(props.apple) {
        listOf(clientId, jwksUri, issuer, tokenUri, revokeUri, teamId, keyId, privateKey).none { it.isBlank() }
    }

    private val clientSecret by lazy {
        with(props.apple) { AppleClientSecret(teamId = teamId, clientId = clientId, keyId = keyId, privateKey = privateKey) }
    }

    private companion object {
        private val log = LoggerFactory.getLogger(AppleOAuthClient::class.java)

        /** 화면에 그대로 나가는 문구 — 구현 상태(JWKS 등)를 싣지 않는다. */
        private const val NOT_READY = "애플 로그인은 아직 준비 중이에요."
    }
}
