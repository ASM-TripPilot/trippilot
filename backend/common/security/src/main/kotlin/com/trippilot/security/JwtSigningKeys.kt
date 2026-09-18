package com.trippilot.security

import com.nimbusds.jose.jwk.RSAKey
import org.slf4j.LoggerFactory
import java.security.KeyFactory
import java.security.KeyPairGenerator
import java.security.interfaces.RSAPrivateCrtKey
import java.security.interfaces.RSAPublicKey
import java.security.spec.PKCS8EncodedKeySpec
import java.security.spec.RSAPublicKeySpec
import java.util.Base64

/**
 * RS256 서명키를 **설정에서 받거나, 없으면 만든다**(TRIP-153 후속).
 *
 * ## 왜 필요한가 — 기동마다 새 키는 복제본을 못 늘린다
 *
 * 종전 구현은 환경 분기 없이 기동할 때마다 키페어를 새로 만들었다. 주석은 "dev/test 는" 이라고
 * 적었지만 코드에 그 조건이 없어 운영에서도 같았다. 그 상태의 증상은 무게가 갈린다:
 *
 * - **복제본이 둘 이상이면 치명적이다.** A 가 서명한 액세스 토큰을 B 가 검증하지 못해 **요청마다
 *   무작위 401** 이 난다. 클라이언트가 리프레시로 새 토큰을 받아도 다음 요청이 다른 인스턴스로
 *   가면 같은 일이 반복된다 — 로그인이 사실상 깨진다.
 * - **재배포마다 액세스 토큰 무효화**는 성가심 수준이다. 리프레시 토큰은 JWT 가 아니라 DB 행이라
 *   (`refresh_session`, 원문 미저장) 재발급으로 회복된다.
 *
 * ## kid 를 지문에서 뽑는 이유
 *
 * 같은 키를 읽은 두 인스턴스가 **같은 `kid`** 를 내야 한다. 종전처럼 `UUID.randomUUID()` 를 쓰면
 * 키가 같아도 인스턴스마다 다른 `kid` 가 붙어, 키를 맞춰 놓고도 헤더만 보고 거르는 경로에서 어긋난다.
 * 지문(RFC 7638 thumbprint)은 키에서 결정론으로 파생되므로 그 문제가 없다.
 */
internal object JwtSigningKeys {

    private val log = LoggerFactory.getLogger(JwtSigningKeys::class.java)

    /**
     * [encoded] 가 비어 있으면 새로 만들고, 있으면 그것을 읽는다.
     *
     * **읽기에 실패하면 예외다 — 조용히 생성으로 떨어지지 않는다.** 그렇게 두면 "키를 넣었는데
     * 여전히 인스턴스마다 다른" 상태가 되고, 증상이 복제본을 늘린 뒤에야 나타나 원인에서 멀어진다.
     */
    fun load(encoded: String, requireConfigured: Boolean): RSAKey {
        val trimmed = encoded.trim()
        if (trimmed.isEmpty()) {
            check(!requireConfigured) {
                "trippilot.jwt.require-configured-key=true 인데 서명키(JWT_SIGNING_KEY)가 비어 있습니다. " +
                    "이대로 기동하면 인스턴스마다 다른 키로 서명해 복제본 사이에서 로그인이 깨집니다. " +
                    "키를 주입하거나, 단일 인스턴스로 돌리려면 require-configured-key 를 끄십시오."
            }
            log.warn(
                "JWT 서명키(JWT_SIGNING_KEY)가 비어 있어 **기동 시 생성**합니다 — 재시작하면 회전되고, " +
                    "복제본을 둘 이상 띄우면 서로의 토큰을 검증하지 못합니다. 배포 환경에서는 반드시 주입하십시오.",
            )
            return generate()
        }
        return fromPkcs8(trimmed)
    }

    /** 새 키페어. 지문 kid 라 "생성했다"는 사실 자체는 로그가 말한다. */
    private fun generate(): RSAKey {
        val pair = KeyPairGenerator.getInstance("RSA").apply { initialize(KEY_SIZE) }.generateKeyPair()
        return RSAKey.Builder(pair.public as RSAPublicKey)
            .privateKey(pair.private)
            .keyIDFromThumbprint()
            .build()
    }

    /**
     * base64(PKCS#8) 개인키 한 줄에서 RSA 키를 복원한다.
     *
     * **공개키를 따로 받지 않는다** — RSA 개인키(CRT 형식)가 modulus 와 public exponent 를 이미 들고
     * 있어 거기서 파생된다. 둘을 따로 주게 하면 짝이 어긋난 조합을 넣을 수 있고, 그때 증상은
     * "서명은 되는데 검증만 실패"라 원인이 안 보인다.
     *
     * PEM 헤더(`-----BEGIN ...`)와 줄바꿈은 걷어낸다 — 환경변수에 넣다 보면 섞여 들어온다.
     */
    private fun fromPkcs8(encoded: String): RSAKey {
        val body = encoded
            .replace(PEM_HEADER, "").replace(PEM_FOOTER, "")
            .filterNot { it.isWhitespace() }
        val der = runCatching { Base64.getDecoder().decode(body) }
            .getOrElse { error("JWT 서명키를 base64 로 읽지 못했습니다 — base64(PKCS#8) 한 줄이어야 합니다. 원인=${it.javaClass.simpleName}") }

        val private = runCatching { KeyFactory.getInstance("RSA").generatePrivate(PKCS8EncodedKeySpec(der)) }
            .getOrElse { error("JWT 서명키가 PKCS#8 RSA 개인키가 아닙니다. 원인=${it.javaClass.simpleName}") }

        val crt = private as? RSAPrivateCrtKey
            ?: error("JWT 서명키에 공개 지수가 없습니다(CRT 형식이 아님) — 공개키를 파생할 수 없습니다.")

        val public = KeyFactory.getInstance("RSA")
            .generatePublic(RSAPublicKeySpec(crt.modulus, crt.publicExponent)) as RSAPublicKey

        return RSAKey.Builder(public)
            .privateKey(private)
            .keyIDFromThumbprint() // 같은 키 → 같은 kid. 인스턴스마다 달라지면 안 된다.
            .build()
    }

    private const val KEY_SIZE = 2048
    private const val PEM_HEADER = "-----BEGIN PRIVATE KEY-----"
    private const val PEM_FOOTER = "-----END PRIVATE KEY-----"
}
