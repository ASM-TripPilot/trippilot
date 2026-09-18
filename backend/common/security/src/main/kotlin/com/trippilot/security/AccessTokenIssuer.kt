package com.trippilot.security

import org.springframework.security.oauth2.jose.jws.SignatureAlgorithm
import org.springframework.security.oauth2.jwt.JwsHeader
import org.springframework.security.oauth2.jwt.JwtClaimsSet
import org.springframework.security.oauth2.jwt.JwtEncoder
import org.springframework.security.oauth2.jwt.JwtEncoderParameters
import org.springframework.stereotype.Component
import java.time.Clock
import java.time.Instant
import java.util.UUID

/**
 * 서명된 RS256 액세스 토큰 발급(공용 인프라, 설계 §3).
 *
 * 클레임: iss·aud·sub(=accountId)·iat·exp·jti(UUID), kid 헤더. **PII 미포함**.
 * 검증은 무상태(JwtDecoder). 리프레시 토큰·세션은 auth 모듈이 소유(회전·탈취감지).
 */
@Component
class AccessTokenIssuer(
    private val jwtEncoder: JwtEncoder,
    private val props: JwtProperties,
    private val clock: Clock,
) {
    fun issue(subject: String): AccessToken {
        val issuedAt = clock.instant()
        val expiresAt = issuedAt.plus(props.accessTokenTtl)
        val claims = JwtClaimsSet.builder()
            .issuer(props.issuer)
            .audience(listOf(props.audience))
            .subject(subject)
            .issuedAt(issuedAt)
            .expiresAt(expiresAt)
            .id(UUID.randomUUID().toString())
            .build()
        val header = JwsHeader.with(SignatureAlgorithm.RS256).build()
        val value = jwtEncoder.encode(JwtEncoderParameters.from(header, claims)).tokenValue
        return AccessToken(value = value, expiresAt = expiresAt)
    }
}

/** 발급된 액세스 토큰 + 만료 시각(응답의 expiresIn 계산용). */
data class AccessToken(
    val value: String,
    val expiresAt: Instant,
)
