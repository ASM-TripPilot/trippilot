package com.trippilot.auth.adapter.out.external

import com.nimbusds.jose.JWSAlgorithm
import com.nimbusds.jose.JWSHeader
import com.nimbusds.jose.crypto.RSASSASigner
import com.nimbusds.jose.jwk.JWKSet
import com.nimbusds.jose.jwk.RSAKey
import com.nimbusds.jose.jwk.gen.RSAKeyGenerator
import com.nimbusds.jwt.JWTClaimsSet
import com.nimbusds.jwt.SignedJWT
import com.trippilot.auth.domain.Provider
import com.trippilot.core.error.AuthenticationRequired
import com.trippilot.core.error.ErrorCode
import com.trippilot.core.error.ProviderNotSupported
import com.trippilot.core.error.UpstreamUnavailable
import io.kotest.assertions.throwables.shouldThrow
import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.shouldBe
import io.kotest.matchers.string.shouldNotContain
import io.kotest.property.Arb
import io.kotest.property.arbitrary.of
import io.kotest.property.checkAll
import org.springframework.http.MediaType
import org.springframework.security.oauth2.jwt.BadJwtException
import org.springframework.test.web.client.ExpectedCount.manyTimes
import org.springframework.test.web.client.MockRestServiceServer
import org.springframework.test.web.client.match.MockRestRequestMatchers.requestTo
import org.springframework.test.web.client.response.DefaultResponseCreator
import org.springframework.test.web.client.response.MockRestResponseCreators.withServerError
import org.springframework.test.web.client.response.MockRestResponseCreators.withSuccess
import org.springframework.web.client.RestClient
import org.springframework.web.client.RestTemplate
import java.time.Instant
import java.util.Date

/**
 * Apple 은 userinfo 가 없어 **우리가 서명을 검증한다** — 그래서 이 테스트가 재는 것은 파싱이 아니라 **차단**이다.
 *
 * 세 가지가 각각 없을 때 무엇이 뚫리는지:
 *
 * - **서명 검증 없음** → 아무나 `sub` 를 지어내 남의 계정으로 로그인한다(`sub` 가 계정 식별키다).
 * - **`aud` 검증 없음** → **다른 애플 앱 개발자가 자기 앱의 id_token 으로 우리 계정에 들어온다.**
 *   Apple 은 자기 고객 전원에게 유효한 서명을 발급하므로 서명만 보는 것은 검증이 아니다. 가장 놓치기 쉽다.
 * - **`exp`·`iss` 검증 없음** → 만료·타 발급자 토큰이 통과한다.
 *
 * 실 Apple 호출 0 — 테스트용 RSA 키로 JWKS 를 세우고 그 키로 id_token 을 서명한다(D37).
 */
class AppleOAuthClientTest : StringSpec({

    "정상 id_token 에서 sub·email 을 취한다" {
        val profile = appleClient().fetchProfileByAccessToken(appleIdToken())

        profile.provider shouldBe Provider.APPLE
        profile.providerSub shouldBe APPLE_SUB
        profile.email shouldBe "user@privaterelay.appleid.com"
    }

    "email 클레임이 없으면 null 이다 — Apple 은 비공개 릴레이거나 아예 안 준다" {
        val profile = appleClient().fetchProfileByAccessToken(appleIdToken(email = null))

        profile.email shouldBe null
    }

    "위조 서명은 막힌다 — 없으면 아무나 sub 를 지어내 남의 계정으로 들어온다" {
        // 신뢰하는 kid 를 그대로 달고 **다른 키**로 서명했다. kid 만 보고 통과시키면 여기서 뚫린다.
        shouldThrow<BadJwtException> {
            appleClient().fetchProfileByAccessToken(appleIdToken(key = forgedKey))
        }
    }

    "다른 앱의 토큰은 막힌다 — aud 가 우리 번들 ID 가 아니다" {
        shouldThrow<BadJwtException> {
            appleClient().fetchProfileByAccessToken(appleIdToken(audience = "com.someone.else.app"))
        }
    }

    "만료된 토큰은 막힌다" {
        shouldThrow<BadJwtException> {
            // JwtTimestampValidator 기본 허용오차가 60초라 그보다 넉넉히 넘긴다.
            appleClient().fetchProfileByAccessToken(appleIdToken(expiresAt = Instant.now().minusSeconds(600)))
        }
    }

    "다른 발급자의 토큰은 막힌다" {
        shouldThrow<BadJwtException> {
            appleClient().fetchProfileByAccessToken(appleIdToken(issuer = "https://evil.example"))
        }
    }

    // ── 사용자에게 무엇으로 보이는가 ─────────────────────────────────────────────
    // 위 예외들은 어댑터를 지나면서 상태코드로 번역된다. 그 번역이 이 티켓의 계약이다.

    "검증 실패는 어댑터를 지나 401 SOCIAL_AUTH_FAILED 가 된다" {
        val adapter = SocialAuthAdapter(listOf(appleClient()))

        val ex = shouldThrow<AuthenticationRequired> {
            adapter.authenticateWithAccessToken(Provider.APPLE, appleIdToken(key = forgedKey))
        }
        ex.errorCode shouldBe ErrorCode.SOCIAL_AUTH_FAILED
    }

    "JWKS 를 못 가져오면 401 이 아니라 503 이다 — 자격 문제가 아니라 일시 장애다" {
        // 401 로 뭉개면 앱이 '다시 시도'를 권하고 사용자는 같은 실패를 반복한다(TRIP-249 와 같은 종류).
        val adapter = SocialAuthAdapter(listOf(appleClient(jwksResponse = withServerError())))

        val ex = shouldThrow<UpstreamUnavailable> {
            adapter.authenticateWithAccessToken(Provider.APPLE, appleIdToken())
        }
        ex.source shouldBe Provider.APPLE.name
    }

    "설정이 안 주입된 환경은 501 이다 — 인증 실패(401)와 갈린다" {
        val ex = shouldThrow<ProviderNotSupported> {
            appleClient(clientId = "").fetchProfileByAccessToken(appleIdToken())
        }

        ex.errorCode shouldBe ErrorCode.PROVIDER_NOT_SUPPORTED
    }

    "code 교환 흐름은 아직 501 이다 — p8 client_secret 서명이 필요하다(TRIP-933)" {
        shouldThrow<ProviderNotSupported> {
            appleClient().fetchProfile("code", "verifier", "trippilot://auth")
        }
    }

    "메시지에 내부 사정을 싣지 않는다 — 노출하는 것은 가용성뿐이다(SECURITY-15)" {
        val message = shouldThrow<ProviderNotSupported> {
            appleClient(clientId = "").fetchProfileByAccessToken(appleIdToken())
        }.message.orEmpty()

        message shouldNotContain "JWKS"
        message shouldNotContain "서명"
        message shouldNotContain "aud"
    }

    // ── 불변식 ───────────────────────────────────────────────────────────────────

    """서명·aud·iss·exp 중 하나라도 어긋난 토큰은 프로필이 되지 않는다""" {
        val client = appleClient()

        checkAll(
            Arb.of(appleKey, forgedKey),
            Arb.of(BUNDLE_ID, "com.someone.else.app"),
            Arb.of(APPLE_ISSUER, "https://evil.example"),
            Arb.of(600L, -600L),
        ) { key, audience, issuer, ttlSeconds ->
            val token = appleIdToken(
                key = key,
                audience = audience,
                issuer = issuer,
                expiresAt = Instant.now().plusSeconds(ttlSeconds),
            )
            val pristine = key === appleKey && audience == BUNDLE_ID && issuer == APPLE_ISSUER && ttlSeconds > 0

            if (pristine) {
                client.fetchProfileByAccessToken(token).providerSub shouldBe APPLE_SUB
            } else {
                shouldThrow<BadJwtException> { client.fetchProfileByAccessToken(token) }
            }
        }
    }
})

// ── 픽스처 ───────────────────────────────────────────────────────────────────────
// 이름을 Apple 접두로 두는 이유: 같은 패키지의 다른 테스트 파일과 최상위 선언이 충돌하면
// "Redeclaration" 으로 컴파일이 깨진다(anti-patterns · TRIP-178).

private const val BUNDLE_ID = "com.trippilot.travel"
private const val APPLE_ISSUER = "https://appleid.apple.com"
private const val APPLE_JWKS_URI = "https://appleid.example/auth/keys"
private const val APPLE_SUB = "001234.fedcba9876543210.0000"

/** Apple 이 가진 키라고 가정하는 것 — JWKS 로 공개한다. */
private val appleKey: RSAKey = RSAKeyGenerator(2048).keyID("apple-kid-1").generate()

/** 공격자의 키. **kid 는 같다** — kid 만 믿고 넘기는 구현을 잡기 위해서다. */
private val forgedKey: RSAKey = RSAKeyGenerator(2048).keyID("apple-kid-1").generate()

private val trustedJwks: String = JWKSet(listOf(appleKey.toPublicJWK())).toString()

private fun appleClient(
    clientId: String = BUNDLE_ID,
    issuer: String = APPLE_ISSUER,
    jwksUri: String = APPLE_JWKS_URI,
    jwksResponse: DefaultResponseCreator = withSuccess(trustedJwks, MediaType.APPLICATION_JSON),
): AppleOAuthClient {
    val jwksTemplate = RestTemplate()
    MockRestServiceServer.bindTo(jwksTemplate).ignoreExpectOrder(true).build()
        .expect(manyTimes(), requestTo(jwksUri))
        .andRespond(jwksResponse)

    return AppleOAuthClient(
        props = SocialProviderProperties(
            apple = SocialProviderProperties.ProviderConfig(
                clientId = clientId,
                issuer = issuer,
                jwksUri = jwksUri,
            ),
        ),
        restClientBuilder = RestClient.builder(),
        appleJwksRestTemplate = jwksTemplate,
    )
}

private fun appleIdToken(
    key: RSAKey = appleKey,
    subject: String = APPLE_SUB,
    audience: String = BUNDLE_ID,
    issuer: String = APPLE_ISSUER,
    email: String? = "user@privaterelay.appleid.com",
    expiresAt: Instant = Instant.now().plusSeconds(600),
): String {
    val claims = JWTClaimsSet.Builder()
        .issuer(issuer)
        .subject(subject)
        .audience(audience)
        // iat 를 exp 기준으로 잡는다. `Instant.now()` 로 고정하면 만료 토큰이 `iat > exp` 가 되어
        // **Spring 의 Jwt 생성이 형식 오류로 먼저 막고**, 정작 재려던 만료 검증에는 닿지 않는다
        // (역검증 실측 — 그 상태로 테스트가 초록이었다). 실제 만료 토큰은 iat·exp 가 둘 다 과거다.
        .issueTime(Date.from(expiresAt.minusSeconds(600)))
        .expirationTime(Date.from(expiresAt))
        .apply { email?.let { claim("email", it) } }
        .build()

    return SignedJWT(JWSHeader.Builder(JWSAlgorithm.RS256).keyID(key.keyID).build(), claims)
        .apply { sign(RSASSASigner(key)) }
        .serialize()
}
