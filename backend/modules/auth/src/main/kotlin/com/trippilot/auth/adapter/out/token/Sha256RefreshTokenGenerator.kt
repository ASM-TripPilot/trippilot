package com.trippilot.auth.adapter.out.token

import com.trippilot.auth.domain.port.GeneratedRefreshToken
import com.trippilot.auth.domain.port.RefreshTokenGenerator
import org.springframework.stereotype.Component
import java.security.MessageDigest
import java.security.SecureRandom
import java.util.Base64
import java.util.HexFormat

/**
 * 불투명 리프레시 토큰 — 256비트 난수(base64url) 원문 + SHA-256 해시(저장용).
 * 원문은 반환 즉시 폐기되고 서버는 해시만 보관 — DB 유출 시에도 원문 복원 불가.
 */
@Component
class Sha256RefreshTokenGenerator : RefreshTokenGenerator {
    private val random = SecureRandom()

    override fun generate(): GeneratedRefreshToken {
        val bytes = ByteArray(32).also(random::nextBytes)
        val raw = Base64.getUrlEncoder().withoutPadding().encodeToString(bytes)
        return GeneratedRefreshToken(rawToken = raw, tokenHash = hash(raw))
    }

    override fun hash(rawToken: String): String {
        val digest = MessageDigest.getInstance("SHA-256").digest(rawToken.toByteArray(Charsets.UTF_8))
        return HexFormat.of().formatHex(digest)
    }
}
