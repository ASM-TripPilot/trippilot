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

/**
 * RS256 서명키 · 인코더 · 디코더 빈. 무상태 검증(서명 + iss/aud/exp).
 *
 * **서명키는 설정에서 받는다**([JwtProperties.signingKey]). 비어 있으면 기동 시 생성하고 경고를
 * 남긴다 — 그 상태는 **복제본을 둘 이상 띄우지 못한다**(인스턴스마다 다른 키로 서명한다).
 * 배포에서 그 상태로 뜨는 것을 막으려면 [JwtProperties.requireConfiguredKey] 를 켠다.
 * 자세한 사정과 kid 파생 근거는 [JwtSigningKeys] 에 있다.
 */
@Configuration
@EnableConfigurationProperties(JwtProperties::class)
class JwtSecurityConfig {

    @Bean
    fun rsaKey(props: JwtProperties): RSAKey =
        JwtSigningKeys.load(props.signingKey, props.requireConfiguredKey)

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
