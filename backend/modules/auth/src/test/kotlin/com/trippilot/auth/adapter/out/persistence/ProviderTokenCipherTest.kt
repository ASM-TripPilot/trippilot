package com.trippilot.auth.adapter.out.persistence

import io.kotest.assertions.throwables.shouldThrow
import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.shouldBe
import io.kotest.matchers.shouldNotBe
import io.kotest.matchers.string.shouldNotContain
import java.util.Base64

/** TRIP-933 — Apple refresh_token 은 DB 에 평문으로 남지 않는다. */
class ProviderTokenCipherTest : StringSpec({

    val key = Base64.getEncoder().encodeToString(ByteArray(32) { it.toByte() })

    "암호화한 값은 평문을 담지 않고, 복호화하면 원래 값이다" {
        val cipher = ProviderTokenCipher(key)

        val stored = cipher.encrypt("apple-refresh-token")

        stored shouldNotContain "apple-refresh-token"
        cipher.decrypt(stored) shouldBe "apple-refresh-token"
    }

    "같은 값도 매번 다른 암호문이 된다 — IV 재사용이 없다" {
        val cipher = ProviderTokenCipher(key)
        cipher.encrypt("same") shouldNotBe cipher.encrypt("same")
    }

    "다른 키로는 풀리지 않는다" {
        val stored = ProviderTokenCipher(key).encrypt("apple-refresh-token")
        val other = ProviderTokenCipher(Base64.getEncoder().encodeToString(ByteArray(32) { 7 }))

        shouldThrow<Exception> { other.decrypt(stored) }
    }

    "키가 비면 미설정이다 — 부팅은 깨지지 않는다" {
        ProviderTokenCipher("").configured shouldBe false
        ProviderTokenCipher(key).configured shouldBe true
    }

    "키 길이가 틀리면 기동 때 바로 알린다 — AES-128 로 조용히 약해지지 않게" {
        shouldThrow<IllegalArgumentException> { ProviderTokenCipher(Base64.getEncoder().encodeToString(ByteArray(16))) }
    }
})
