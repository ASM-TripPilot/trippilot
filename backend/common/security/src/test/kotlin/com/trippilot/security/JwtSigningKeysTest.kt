package com.trippilot.security

import io.kotest.assertions.throwables.shouldThrow
import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.shouldBe
import io.kotest.matchers.shouldNotBe
import io.kotest.matchers.string.shouldContain
import java.security.KeyPairGenerator
import java.util.Base64

/**
 * JWT 서명키 로드(TRIP-153 후속).
 *
 * **이 스펙이 지키는 것은 하나다 — 같은 키를 읽은 두 인스턴스가 서로의 토큰을 읽는다.**
 * 종전 구현은 기동마다 키를 새로 만들어 그 성질이 없었고, 증상은 **복제본을 늘린 뒤에야**
 * 무작위 401 로 나타난다. 단일 인스턴스에서는 끝까지 안 보이므로 여기서 못 박는다.
 */
class JwtSigningKeysTest : StringSpec({

    fun newPkcs8Base64(): String {
        val pair = KeyPairGenerator.getInstance("RSA").apply { initialize(2048) }.generateKeyPair()
        return Base64.getEncoder().encodeToString(pair.private.encoded)
    }

    "같은 키를 읽은 둘은 같은 kid·같은 공개키를 낸다 — 복제본이 서로의 토큰을 읽는 조건" {
        val encoded = newPkcs8Base64()

        val a = JwtSigningKeys.load(encoded, requireConfigured = false)
        val b = JwtSigningKeys.load(encoded, requireConfigured = false)

        a.keyID shouldBe b.keyID
        a.toRSAPublicKey().modulus shouldBe b.toRSAPublicKey().modulus
    }

    /**
     * 종전 동작(기동마다 생성)이 남아 있으면 이것이 통과한다 — 그래서 위 단언과 짝으로 둔다.
     * 하나만 있으면 "키를 안 읽고 늘 생성"하는 구현도 위를 통과시킬 수 없지만, 이쪽이 회귀의
     * 방향을 이름으로 남긴다.
     */
    "키를 안 주면 매번 다른 키다 — 그 상태로는 복제본을 못 늘린다" {
        val a = JwtSigningKeys.load("", requireConfigured = false)
        val b = JwtSigningKeys.load("", requireConfigured = false)

        a.keyID shouldNotBe b.keyID
    }

    /**
     * 주입한 키가 **실제로 서명에 쓰이는지**는 공개키 비교만으로는 부족하다 — 개인키가 엉뚱해도
     * 공개키는 맞을 수 있다(파생을 안 하고 따로 받는 구현이었다면). 같은 키로 만든 두 인스턴스
     * 사이에서 **서명하고 검증**해 본다.
     */
    "A 가 서명한 것을 같은 키의 B 가 검증한다" {
        val encoded = newPkcs8Base64()
        val a = JwtSigningKeys.load(encoded, requireConfigured = false)
        val b = JwtSigningKeys.load(encoded, requireConfigured = false)

        val signer = com.nimbusds.jose.crypto.RSASSASigner(a.toRSAPrivateKey())
        val jwt = com.nimbusds.jwt.SignedJWT(
            com.nimbusds.jose.JWSHeader.Builder(com.nimbusds.jose.JWSAlgorithm.RS256).keyID(a.keyID).build(),
            com.nimbusds.jwt.JWTClaimsSet.Builder().subject("계정").build(),
        ).apply { sign(signer) }

        val verified = jwt.verify(com.nimbusds.jose.crypto.RSASSAVerifier(b.toRSAPublicKey()))

        verified shouldBe true
    }

    /**
     * **조용히 생성으로 떨어지면 안 된다.** 그러면 "키를 넣었는데 여전히 인스턴스마다 다른" 상태가
     * 되고, 증상이 복제본을 늘린 뒤에야 나와 원인에서 한참 멀어진다.
     */
    "읽을 수 없는 키는 예외다 — 생성으로 되돌아가지 않는다" {
        shouldThrow<IllegalStateException> {
            JwtSigningKeys.load("이건 base64 가 아니다!!", requireConfigured = false)
        }.message shouldContain "base64"

        // 올바른 base64 이지만 PKCS#8 RSA 키가 아닌 경우
        shouldThrow<IllegalStateException> {
            JwtSigningKeys.load(Base64.getEncoder().encodeToString(byteArrayOf(1, 2, 3)), requireConfigured = false)
        }.message shouldContain "PKCS#8"
    }

    "PEM 헤더·줄바꿈이 섞여 와도 읽는다 — 환경변수에 붙여넣다 보면 들어온다" {
        val body = newPkcs8Base64().chunked(64).joinToString("\n")
        val pem = "-----BEGIN PRIVATE KEY-----\n$body\n-----END PRIVATE KEY-----\n"

        val key = JwtSigningKeys.load(pem, requireConfigured = false)

        key.keyID shouldBe JwtSigningKeys.load(body, requireConfigured = false).keyID
    }

    /**
     * **발급기까지 관통하는가.** 위 단언들은 `JwtSigningKeys` 만 본다 — 그 키가 실제로
     * `jwtEncoder` 에 실려 나가고 `jwtDecoder` 가 받아들이는지는 별개다. 설정에서 키를 읽어 놓고
     * 빈 생성에 계속 매달려 있어도 위 테스트는 전부 통과한다.
     *
     * 그래서 **설정 → 빈 조립 → 발급 → 검증** 을 한 번 통과시킨다. 다른 인스턴스를 흉내 내
     * 같은 설정으로 조립한 두 번째 디코더로 검증하는 것이 요점이다.
     */
    "설정에 넣은 키로 발급한 토큰을, 같은 설정의 다른 인스턴스가 검증한다" {
        val props = JwtProperties(signingKey = newPkcs8Base64())
        val a = JwtSecurityConfig()
        val b = JwtSecurityConfig() // 복제본
        val keyA = a.rsaKey(props)
        val keyB = b.rsaKey(props)

        val issuer = AccessTokenIssuer(a.jwtEncoder(a.jwkSource(keyA)), props, java.time.Clock.systemUTC())
        val token = issuer.issue(java.util.UUID.randomUUID().toString())

        // B 의 디코더가 A 가 서명한 것을 읽는다 — 이것이 복제본을 늘릴 수 있다는 뜻이다.
        b.jwtDecoder(keyB, props).decode(token.value).subject shouldNotBe null
    }

    /**
     * 배포에서 "키를 잊은 채 떠 있는" 상태를 막는 스위치(TRIP-850 이 켠다). 기본은 꺼짐 —
     * 켜 두면 키를 안 넣은 로컬·CI 가 통째로 죽는다.
     */
    "강제를 켜면 키가 빈 채로 기동하지 않는다" {
        shouldThrow<IllegalStateException> {
            JwtSigningKeys.load("", requireConfigured = true)
        }.message shouldContain "require-configured-key"
    }
})
