package com.trippilot.auth.adapter.out.external

import ch.qos.logback.classic.Logger
import ch.qos.logback.classic.spi.ILoggingEvent
import ch.qos.logback.core.read.ListAppender
import com.nimbusds.jose.JWSAlgorithm
import com.nimbusds.jose.JWSHeader
import com.nimbusds.jose.crypto.ECDSAVerifier
import com.nimbusds.jose.crypto.RSASSASigner
import com.nimbusds.jose.jwk.Curve
import com.nimbusds.jose.jwk.ECKey
import com.nimbusds.jose.jwk.JWKSet
import com.nimbusds.jose.jwk.RSAKey
import com.nimbusds.jose.jwk.gen.ECKeyGenerator
import com.nimbusds.jose.jwk.gen.RSAKeyGenerator
import com.nimbusds.jwt.JWTClaimsSet
import com.nimbusds.jwt.SignedJWT
import com.trippilot.auth.domain.Provider
import io.kotest.assertions.throwables.shouldThrow
import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.collections.shouldContainExactly
import io.kotest.matchers.nulls.shouldBeNull
import io.kotest.matchers.shouldBe
import io.kotest.matchers.string.shouldNotContain
import org.slf4j.LoggerFactory
import org.springframework.http.HttpMethod
import org.springframework.http.MediaType
import org.springframework.test.web.client.ExpectedCount.manyTimes
import org.springframework.test.web.client.ExpectedCount.never
import org.springframework.test.web.client.MockRestServiceServer
import org.springframework.test.web.client.match.MockRestRequestMatchers.method
import org.springframework.test.web.client.match.MockRestRequestMatchers.requestTo
import org.springframework.test.web.client.response.MockRestResponseCreators.withServerError
import org.springframework.test.web.client.response.MockRestResponseCreators.withSuccess
import org.springframework.web.client.HttpServerErrorException
import org.springframework.web.client.RestClient
import org.springframework.web.client.RestTemplate
import java.net.URLDecoder
import java.time.Duration
import java.time.Instant
import java.util.Base64
import java.util.Date

/**
 * TRIP-933 — Apple 토큰 revoke 경로(code 교환 · revoke · client_secret).
 *
 * 실 Apple 호출 0 — 토큰·revoke 엔드포인트는 MockRestServiceServer, id_token 은 테스트 RSA 키 + 로컬 JWKS,
 * p8 은 테스트에서 생성한 EC P-256 키다(D37).
 */
class AppleTokenRevocationTest : StringSpec({

    // ── client_secret ────────────────────────────────────────────────────────────

    "client_secret 은 p8 로 서명한 ES256 JWT 다 — iss=Team ID · sub=번들 ID · aud=Apple · kid=Key ID · 5분" {
        val now = Instant.parse("2026-09-23T00:00:00Z")

        val jwt = SignedJWT.parse(AppleClientSecret(REVOKE_TEAM_ID, REVOKE_BUNDLE_ID, REVOKE_KEY_ID, revokeP8Pem).sign(now))

        jwt.header.algorithm shouldBe JWSAlgorithm.ES256
        jwt.header.keyID shouldBe REVOKE_KEY_ID
        jwt.verify(ECDSAVerifier(revokeEcKey.toECPublicKey())) shouldBe true // 우리 p8 로 서명됐다
        with(jwt.jwtClaimsSet) {
            issuer shouldBe REVOKE_TEAM_ID
            subject shouldBe REVOKE_BUNDLE_ID
            audience shouldContainExactly listOf("https://appleid.apple.com")
            issueTime.toInstant() shouldBe now
            Duration.between(issueTime.toInstant(), expirationTime.toInstant()) shouldBe Duration.ofMinutes(5)
        }
    }

    "p8 이 줄바꿈 이스케이프(\\n)로 한 줄에 와도 해석된다 — env 로 들어오는 모양이다" {
        val oneLine = revokeP8Pem.replace("\n", "\\n")
        val jwt = SignedJWT.parse(AppleClientSecret(REVOKE_TEAM_ID, REVOKE_BUNDLE_ID, REVOKE_KEY_ID, oneLine).sign(Instant.now()))
        jwt.verify(ECDSAVerifier(revokeEcKey.toECPublicKey())) shouldBe true
    }

    // ── code 교환 ────────────────────────────────────────────────────────────────

    "authorizationCode 를 교환해 refresh_token 을 돌려준다 — 교환 응답의 id_token 도 JWKS 로 검증한다" {
        val h = revokeHarness()
        h.server.expect(requestTo(REVOKE_TOKEN_URI)).andExpect(method(HttpMethod.POST))
            .andRespond(withSuccess(tokenResponse(revokeIdToken()), MediaType.APPLICATION_JSON))

        h.client.exchangeRevocationToken(Provider.APPLE, "apple-code", REVOKE_SUB) shouldBe "apple-refresh"

        val form = h.lastForm()
        form["grant_type"] shouldBe "authorization_code"
        form["code"] shouldBe "apple-code"
        form["client_id"] shouldBe REVOKE_BUNDLE_ID
        SignedJWT.parse(form["client_secret"]).verify(ECDSAVerifier(revokeEcKey.toECPublicKey())) shouldBe true
        h.server.verify()
    }

    "교환 결과의 sub 가 로그인한 사람과 다르면 버린다 — 남의 code 를 붙여 남의 토큰을 걸 수 없다" {
        val h = revokeHarness()
        h.server.expect(requestTo(REVOKE_TOKEN_URI))
            .andRespond(withSuccess(tokenResponse(revokeIdToken(subject = "someone-else")), MediaType.APPLICATION_JSON))

        h.client.exchangeRevocationToken(Provider.APPLE, "victim-code", REVOKE_SUB).shouldBeNull()
    }

    "교환 응답의 id_token 서명이 위조면 버린다" {
        val h = revokeHarness()
        h.server.expect(requestTo(REVOKE_TOKEN_URI))
            .andRespond(withSuccess(tokenResponse(revokeIdToken(key = revokeForgedRsa)), MediaType.APPLICATION_JSON))

        h.client.exchangeRevocationToken(Provider.APPLE, "apple-code", REVOKE_SUB).shouldBeNull()
    }

    "Apple 토큰 엔드포인트가 5xx 여도 던지지 않고 null 이다 — 로그인을 막지 않는다" {
        val h = revokeHarness()
        h.server.expect(requestTo(REVOKE_TOKEN_URI)).andRespond(withServerError())

        h.client.exchangeRevocationToken(Provider.APPLE, "apple-code", REVOKE_SUB).shouldBeNull()
    }

    "Team ID·Key ID·p8 이 없으면 Apple 을 부르지 않고 null 이다 — 부팅·로그인 무영향" {
        val h = revokeHarness(privateKey = "")
        h.server.expect(never(), requestTo(REVOKE_TOKEN_URI))

        h.client.exchangeRevocationToken(Provider.APPLE, "apple-code", REVOKE_SUB).shouldBeNull()
        h.server.verify()
    }

    "애플 외 제공자는 교환하지 않는다" {
        val h = revokeHarness()
        h.server.expect(never(), requestTo(REVOKE_TOKEN_URI))

        h.client.exchangeRevocationToken(Provider.KAKAO, "kakao-code", REVOKE_SUB).shouldBeNull()
        h.server.verify()
    }

    // ── revoke ───────────────────────────────────────────────────────────────────

    "revoke 는 refresh_token 과 새 client_secret 을 Apple revoke 엔드포인트로 보낸다" {
        val h = revokeHarness()
        h.server.expect(requestTo(REVOKE_REVOKE_URI)).andExpect(method(HttpMethod.POST)).andRespond(withSuccess())

        h.client.revoke(Provider.APPLE, "apple-refresh")

        val form = h.lastForm()
        form["token"] shouldBe "apple-refresh"
        form["token_type_hint"] shouldBe "refresh_token"
        form["client_id"] shouldBe REVOKE_BUNDLE_ID
        SignedJWT.parse(form["client_secret"]).jwtClaimsSet.issuer shouldBe REVOKE_TEAM_ID
        h.server.verify()
    }

    "Apple revoke 가 5xx 면 예외다 — 스위프가 잡아 재시도로 남긴다" {
        val h = revokeHarness()
        h.server.expect(requestTo(REVOKE_REVOKE_URI)).andRespond(withServerError())

        shouldThrow<HttpServerErrorException> { h.client.revoke(Provider.APPLE, "apple-refresh") }
    }

    // ── SECURITY-15: p8 은 어디에도 실리지 않는다 ────────────────────────────────

    "p8 개인키는 설정 객체 문자열·예외 메시지·로그 어디에도 실리지 않는다(SECURITY-15)" {
        val p8Body = revokeP8Pem.lines().filterNot { it.startsWith("-----") }.joinToString("")
        val fragments = listOf(p8Body, p8Body.take(24), p8Body.takeLast(24))

        // 1) 설정 객체가 로그에 통째로 찍히는 경우
        val props = revokeProps()
        fragments.forEach { props.toString() shouldNotContain it }

        // 2) 교환·revoke 실패의 예외·로그
        val appender = ListAppender<ILoggingEvent>().apply { start() }
        val logger = LoggerFactory.getLogger(AppleOAuthClient::class.java) as Logger
        logger.addAppender(appender)
        val revokeError = try {
            val h = revokeHarness()
            h.server.expect(manyTimes(), requestTo(REVOKE_TOKEN_URI)).andRespond(withServerError())
            h.server.expect(manyTimes(), requestTo(REVOKE_REVOKE_URI)).andRespond(withServerError())
            h.client.exchangeRevocationToken(Provider.APPLE, "apple-code", REVOKE_SUB)
            shouldThrow<HttpServerErrorException> { h.client.revoke(Provider.APPLE, "apple-refresh") }
        } finally {
            logger.detachAppender(appender)
        }
        val logged = appender.list.joinToString("\n") { it.formattedMessage + (it.throwableProxy?.message ?: "") }
        val errorText = revokeError.message + revokeError.responseBodyAsString
        fragments.forEach {
            logged shouldNotContain it
            errorText shouldNotContain it
        }

        // 3) p8 이 깨졌을 때의 예외 메시지 — 입력을 되돌려 주지 않는다
        val broken = "-----BEGIN PRIVATE KEY-----\n${p8Body.drop(10)}\n-----END PRIVATE KEY-----"
        val parseError = shouldThrow<IllegalStateException> {
            AppleClientSecret(REVOKE_TEAM_ID, REVOKE_BUNDLE_ID, REVOKE_KEY_ID, broken).sign(Instant.now())
        }
        parseError.cause.shouldBeNull()
        parseError.message shouldBe "Apple 개인키(.p8)를 해석할 수 없습니다."
    }
})

// ── 픽스처 — 이름을 Revoke 접두로 둔다(같은 패키지 최상위 선언 충돌 방지, anti-patterns · TRIP-178) ──

private const val REVOKE_BUNDLE_ID = "com.trippilot.travel"
private const val REVOKE_TEAM_ID = "ABCDE12345"
private const val REVOKE_KEY_ID = "KEY1234567"
private const val REVOKE_SUB = "001234.revoke.0000"
private const val REVOKE_ISSUER = "https://appleid.apple.com"
private const val REVOKE_JWKS_URI = "https://appleid.example/auth/keys"
private const val REVOKE_TOKEN_URI = "https://appleid.example/auth/token"
private const val REVOKE_REVOKE_URI = "https://appleid.example/auth/revoke"

private val revokeEcKey: ECKey = ECKeyGenerator(Curve.P_256).generate()

/** Apple 이 내려 주는 `.p8` 과 같은 모양 — PKCS#8 PEM. */
private val revokeP8Pem: String =
    "-----BEGIN PRIVATE KEY-----\n" +
        Base64.getMimeEncoder(64, "\n".toByteArray()).encodeToString(revokeEcKey.toECPrivateKey().encoded) +
        "\n-----END PRIVATE KEY-----"

private val revokeAppleRsa: RSAKey = RSAKeyGenerator(2048).keyID("apple-kid-r").generate()
private val revokeForgedRsa: RSAKey = RSAKeyGenerator(2048).keyID("apple-kid-r").generate()

private fun revokeProps(privateKey: String = revokeP8Pem) = SocialProviderProperties(
    apple = SocialProviderProperties.ProviderConfig(
        clientId = REVOKE_BUNDLE_ID,
        issuer = REVOKE_ISSUER,
        jwksUri = REVOKE_JWKS_URI,
        tokenUri = REVOKE_TOKEN_URI,
        revokeUri = REVOKE_REVOKE_URI,
        teamId = REVOKE_TEAM_ID,
        keyId = REVOKE_KEY_ID,
        privateKey = privateKey,
    ),
)

private class RevokeHarness(val client: AppleOAuthClient, val server: MockRestServiceServer, private val bodies: List<String>) {
    /** 마지막으로 나간 form 본문을 키→값으로. */
    fun lastForm(): Map<String, String> = bodies.last().split("&").associate {
        val (k, v) = it.split("=", limit = 2)
        URLDecoder.decode(k, Charsets.UTF_8) to URLDecoder.decode(v, Charsets.UTF_8)
    }
}

private fun revokeHarness(privateKey: String = revokeP8Pem): RevokeHarness {
    val jwksTemplate = RestTemplate()
    MockRestServiceServer.bindTo(jwksTemplate).ignoreExpectOrder(true).build()
        .expect(manyTimes(), requestTo(REVOKE_JWKS_URI))
        .andRespond(withSuccess(JWKSet(listOf(revokeAppleRsa.toPublicJWK())).toString(), MediaType.APPLICATION_JSON))

    val bodies = mutableListOf<String>()
    val builder = RestClient.builder().requestInterceptor { request, body, execution ->
        bodies += String(body)
        execution.execute(request, body)
    }
    val server = MockRestServiceServer.bindTo(builder).ignoreExpectOrder(true).build()
    val client = AppleOAuthClient(revokeProps(privateKey), builder, jwksTemplate)
    return RevokeHarness(client, server, bodies)
}

private fun tokenResponse(idToken: String) =
    """{"access_token":"a","token_type":"Bearer","expires_in":3600,"refresh_token":"apple-refresh","id_token":"$idToken"}"""

private fun revokeIdToken(key: RSAKey = revokeAppleRsa, subject: String = REVOKE_SUB): String {
    val exp = Instant.now().plusSeconds(600)
    val claims = JWTClaimsSet.Builder()
        .issuer(REVOKE_ISSUER)
        .subject(subject)
        .audience(REVOKE_BUNDLE_ID)
        .issueTime(Date.from(exp.minusSeconds(600)))
        .expirationTime(Date.from(exp))
        .build()
    return SignedJWT(JWSHeader.Builder(JWSAlgorithm.RS256).keyID(key.keyID).build(), claims)
        .apply { sign(RSASSASigner(key)) }
        .serialize()
}

