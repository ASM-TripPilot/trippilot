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
        /**
         * 제공자 토큰 revoke 용(현재 Apple 만 — TRIP-933). 계정 파기 시 우리 앱의 접근 권한을 제공자 쪽에서도
         * 거둔다(App Store 5.1.1(v)). 나머지 3사는 빈 값이다.
         */
        val revokeUri: String = "",
        /** Apple Developer Team ID(10자리) — client_secret JWT 의 `iss`. 시크릿은 아니다. */
        val teamId: String = "",
        /** Sign in with Apple 키(.p8)의 Key ID — client_secret JWT 헤더 `kid`. 시크릿은 아니다. */
        val keyId: String = "",
        /**
         * **시크릿** — Sign in with Apple 키(.p8) 본문(PKCS#8 PEM 또는 그 base64 본문). client_secret 을
         * 매 요청 ES256 으로 서명하는 데만 쓴다. 평문 커밋 금지(SECURITY-12) — env 로만 들어온다.
         */
        val privateKey: String = "",
    ) {
        /**
         * data class 기본 toString 은 모든 필드를 싣는다 — 설정 객체가 로그·예외 메시지에 한 번만 찍혀도
         * p8 개인키와 client_secret 이 새어 나간다(SECURITY-15). 값 대신 "있음/없음"만 남긴다.
         */
        override fun toString(): String =
            "ProviderConfig(clientId=$clientId, clientSecret=${mask(clientSecret)}, tokenUri=$tokenUri, " +
                "userInfoUri=$userInfoUri, jwksUri=$jwksUri, issuer=$issuer, revokeUri=$revokeUri, " +
                "teamId=$teamId, keyId=$keyId, privateKey=${mask(privateKey)})"

        private fun mask(secret: String): String = if (secret.isEmpty()) "(없음)" else "(설정됨)"
    }
}
