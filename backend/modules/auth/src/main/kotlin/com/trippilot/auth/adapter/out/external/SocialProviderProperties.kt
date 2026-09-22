package com.trippilot.auth.adapter.out.external

import org.springframework.boot.context.properties.ConfigurationProperties

/**
 * 소셜 제공자 설정(외부화 — SECURITY-12, 평문 시크릿 0). dev=.env, prod=Secrets Manager.
 * 값 미주입(IdP 미등록) 시 빈 문자열 — 실제 호출은 IdP 등록 후 검증.
 */
@ConfigurationProperties(prefix = "trippilot.social")
data class SocialProviderProperties(
    val google: ProviderConfig = ProviderConfig(),
    val kakao: ProviderConfig = ProviderConfig(),
    val naver: ProviderConfig = ProviderConfig(),
    val apple: ProviderConfig = ProviderConfig(),
) {
    data class ProviderConfig(
        val clientId: String = "",
        val clientSecret: String = "",
        val tokenUri: String = "",
        val userInfoUri: String = "",
        /**
         * OIDC id_token 검증용(현재 Apple 만 사용 — TRIP-858). 나머지 3사는 userinfo 로 신원을 받으므로 빈 값이다.
         * Apple 전용 프로퍼티 클래스를 따로 두지 않는 이유는 제공자 설정이 한 자리에 모여 있어야 비교되기 때문이다.
         */
        val jwksUri: String = "",
        val issuer: String = "",
    )
}
