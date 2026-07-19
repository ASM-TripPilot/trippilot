package com.trippilot.security

import com.nimbusds.jose.jwk.JWKSet
import com.nimbusds.jose.jwk.RSAKey
import com.nimbusds.jose.jwk.source.ImmutableJWKSet
import com.nimbusds.jose.jwk.source.JWKSource
import com.nimbusds.jose.proc.SecurityContext
import org.springframework.boot.context.properties.EnableConfigurationProperties
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Configuration
import org.springframework.security.oauth2.core.DelegatingOAuth2TokenValidator
import org.springframework.security.oauth2.jwt.JwtClaimNames
import org.springframework.security.oauth2.jwt.JwtClaimValidator
import org.springframework.security.oauth2.jwt.JwtDecoder
import org.springframework.security.oauth2.jwt.JwtEncoder
import org.springframework.security.oauth2.jwt.JwtIssuerValidator
import org.springframework.security.oauth2.jwt.JwtValidators
import org.springframework.security.oauth2.jwt.NimbusJwtDecoder
import org.springframework.security.oauth2.jwt.NimbusJwtEncoder
import java.security.KeyPairGenerator
import java.security.interfaces.RSAPublicKey
import java.util.UUID

/**
 * RS256 서명키 · 인코더 · 디코더 빈. 무상태 검증(서명 + iss/aud/exp).
 *
 * dev/test 는 기동 시 RSA-2048 키페어를 1회 생성(kid 부여) — 재시작 시 회전된다.
 * prod 는 Secrets Manager 에서 JWK 로드로 교체(PD-3), 로드 실패 시 fail-fast(LC-6). TODO(TRIP-153 후속).
 */
@Configuration
@EnableConfigurationProperties(JwtProperties::class)
class JwtSecurityConfig {

    @Bean
    fun rsaKey(): RSAKey {
        val pair = KeyPairGenerator.getInstance("RSA").apply { initialize(2048) }.generateKeyPair()
        return RSAKey.Builder(pair.public as RSAPublicKey)
            .privateKey(pair.private)
            .keyID(UUID.randomUUID().toString())
            .build()
    }

    @Bean
    fun jwkSource(rsaKey: RSAKey): JWKSource<SecurityContext> = ImmutableJWKSet(JWKSet(rsaKey))

    @Bean
    fun jwtEncoder(jwkSource: JWKSource<SecurityContext>): JwtEncoder = NimbusJwtEncoder(jwkSource)

    /** 서명(공개키) + 만료 + iss + aud 검증. PII 없는 최소 검증 체인. */
    @Bean
    fun jwtDecoder(rsaKey: RSAKey, props: JwtProperties): JwtDecoder {
        val decoder = NimbusJwtDecoder.withPublicKey(rsaKey.toRSAPublicKey()).build()
        decoder.setJwtValidator(
            DelegatingOAuth2TokenValidator(
                JwtValidators.createDefault(), // exp · nbf
                JwtIssuerValidator(props.issuer),
                JwtClaimValidator<List<String>?>(JwtClaimNames.AUD) { aud -> aud != null && props.audience in aud },
            ),
        )
        return decoder
    }
}
