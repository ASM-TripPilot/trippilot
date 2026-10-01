package com.trippilot.auth.adapter.out.external

import com.nimbusds.jose.JWSAlgorithm
import com.nimbusds.jose.JWSHeader
import com.nimbusds.jose.crypto.ECDSASigner
import com.nimbusds.jwt.JWTClaimsSet
import com.nimbusds.jwt.SignedJWT
import java.security.KeyFactory
import java.security.interfaces.ECPrivateKey
import java.security.spec.PKCS8EncodedKeySpec
import java.time.Duration
import java.time.Instant
import java.util.Base64
import java.util.Date

/**
 * Apple `client_secret` — 고정 문자열이 아니라 **우리가 p8 키로 서명해 만드는 ES256 JWT** 다(TRIP-933).
 * `/auth/token`(code 교환)과 `/auth/revoke` 두 곳에서만 쓴다. 로그인(id_token JWKS 검증)에는 필요 없다.
 *
 * Apple 은 수명을 최대 6개월까지 허용하지만 **매 요청 새로 만들고 5분만 산다** — 캐시·갱신 시점을 관리할
 * 상태가 사라지고, 서명 한 번은 요청 왕복에 비해 무시할 만하다. 새어도 창이 5분이다.
 */
internal class AppleClientSecret(
    private val teamId: String,
    private val clientId: String,
    private val keyId: String,
    privateKey: String,
) {
    /** 첫 서명에서 한 번만 해석한다. 해석 실패 메시지에 키 본문을 싣지 않는다(SECURITY-15). */
    private val signingKey: ECPrivateKey by lazy { parse(privateKey) }

    fun sign(now: Instant): String {
        val claims = JWTClaimsSet.Builder()
            .issuer(teamId)
            .subject(clientId)
            .audience(AUDIENCE)
            .issueTime(Date.from(now))
            .expirationTime(Date.from(now.plus(LIFETIME)))
            .build()
        return SignedJWT(JWSHeader.Builder(JWSAlgorithm.ES256).keyID(keyId).build(), claims)
            .apply { sign(ECDSASigner(signingKey)) }
            .serialize()
    }

    companion object {
        const val AUDIENCE = "https://appleid.apple.com"
        val LIFETIME: Duration = Duration.ofMinutes(5)

        /**
         * `.p8` 은 PKCS#8 PEM 이다. env 로 들어오면 줄바꿈이 `\n` 두 글자로 오거나 아예 헤더 없이 본문만
         * 올 수 있어, 헤더·공백·이스케이프를 모두 걷어내고 본문만 디코드한다.
         *
         * **원인 예외를 붙이지 않는다** — 디코더·KeyFactory 메시지가 입력 조각을 담을 가능성을 아예 닫는다.
         */
        private fun parse(pem: String): ECPrivateKey = try {
            val body = pem
                .replace("-----BEGIN PRIVATE KEY-----", "")
                .replace("-----END PRIVATE KEY-----", "")
                .replace("\\n", "")
                .replace(Regex("\\s"), "")
            KeyFactory.getInstance("EC").generatePrivate(PKCS8EncodedKeySpec(Base64.getDecoder().decode(body))) as ECPrivateKey
        } catch (_: Exception) {
            throw IllegalStateException("Apple 개인키(.p8)를 해석할 수 없습니다.")
        }
    }
}
