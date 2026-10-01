package com.trippilot.auth.adapter.out.persistence

import org.springframework.beans.factory.annotation.Value
import org.springframework.stereotype.Component
import java.security.SecureRandom
import java.util.Base64
import javax.crypto.Cipher
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec

/**
 * 제공자 revoke 토큰 암호화(TRIP-933) — AES-256-GCM, 저장 형식은 `base64(iv 12바이트 ‖ 암호문+태그)`.
 *
 * Apple refresh_token 은 **우리 앱 이름으로 그 사용자의 애플 연결을 다룰 수 있는 장기 자격증명**이라
 * DB 덤프·백업에 평문으로 남기지 않는다. 키는 env(`SOCIAL_TOKEN_ENCRYPTION_KEY`, base64 32바이트)로만
 * 들어온다(SECURITY-12). 비어 있으면 [configured] 가 false 이고 보관 자체를 건너뛴다 — 부팅은 깨지지 않는다.
 */
@Component
class ProviderTokenCipher(
    @Value("\${trippilot.social.token-encryption-key:}") rawKey: String,
) {
    private val key: SecretKeySpec? = rawKey.takeIf { it.isNotBlank() }?.let {
        val bytes = Base64.getDecoder().decode(it.trim())
        require(bytes.size == KEY_BYTES) { "SOCIAL_TOKEN_ENCRYPTION_KEY 는 base64 로 인코딩한 32바이트여야 합니다." }
        SecretKeySpec(bytes, "AES")
    }

    val configured: Boolean get() = key != null

    fun encrypt(plain: String): String {
        val iv = ByteArray(IV_BYTES).also { random.nextBytes(it) }
        val cipher = Cipher.getInstance(TRANSFORMATION).apply { init(Cipher.ENCRYPT_MODE, requireKey(), GCMParameterSpec(TAG_BITS, iv)) }
        return Base64.getEncoder().encodeToString(iv + cipher.doFinal(plain.toByteArray()))
    }

    fun decrypt(stored: String): String {
        val bytes = Base64.getDecoder().decode(stored)
        val cipher = Cipher.getInstance(TRANSFORMATION).apply {
            init(Cipher.DECRYPT_MODE, requireKey(), GCMParameterSpec(TAG_BITS, bytes, 0, IV_BYTES))
        }
        return String(cipher.doFinal(bytes, IV_BYTES, bytes.size - IV_BYTES))
    }

    private fun requireKey(): SecretKeySpec = checkNotNull(key) { "SOCIAL_TOKEN_ENCRYPTION_KEY 가 설정되지 않았습니다." }

    private companion object {
        const val TRANSFORMATION = "AES/GCM/NoPadding"
        const val KEY_BYTES = 32
        const val IV_BYTES = 12
        const val TAG_BITS = 128
        val random = SecureRandom()
    }
}
