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
    )
}
