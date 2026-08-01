package com.trippilot.security

import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.shouldBe
import io.kotest.matchers.string.shouldNotBeBlank
import java.time.Clock
import java.time.Duration
import java.time.Instant
import java.time.ZoneOffset
import java.util.UUID

/**
 * 액세스 토큰 발급 ↔ 검증 왕복. 실제 IdP·DB 없이 서명·클레임 규약만 검증(순수 크립토).
 */
class AccessTokenIssuerTest : StringSpec({

    val config = JwtSecurityConfig()
    val rsaKey = config.rsaKey()
    val props = JwtProperties()
    val decoder = config.jwtDecoder(rsaKey, props)

    fun issuerWith(clock: Clock) =
        AccessTokenIssuer(config.jwtEncoder(config.jwkSource(rsaKey)), props, clock)

    "발급한 토큰은 sub·iss·aud·jti 클레임을 담고 디코더 검증을 통과한다" {
        val subject = UUID.randomUUID().toString()

        val token = issuerWith(Clock.systemUTC()).issue(subject)

        token.value.shouldNotBeBlank()
        val jwt = decoder.decode(token.value) // 서명 + iss/aud/exp 검증 포함 — 실패 시 예외
        jwt.subject shouldBe subject
        jwt.getClaimAsString("iss") shouldBe props.issuer
        jwt.audience shouldBe listOf(props.audience)
        jwt.getClaimAsString("jti").shouldNotBeBlank()
    }

    "만료 시각은 iat + accessTokenTtl 이다" {
        val issuedAt = Instant.parse("2026-07-19T00:00:00Z")
        val token = issuerWith(Clock.fixed(issuedAt, ZoneOffset.UTC)).issue(UUID.randomUUID().toString())

        token.expiresAt shouldBe issuedAt.plus(Duration.ofHours(1))
    }

    "다른 발급자(iss 불일치) 토큰은 디코더가 거부한다" {
        val alien = AccessTokenIssuer(
            config.jwtEncoder(config.jwkSource(rsaKey)),
            props.copy(issuer = "attacker"),
            Clock.systemUTC(),
        ).issue(UUID.randomUUID().toString())

        runCatching { decoder.decode(alien.value) }.isFailure shouldBe true
    }
})
