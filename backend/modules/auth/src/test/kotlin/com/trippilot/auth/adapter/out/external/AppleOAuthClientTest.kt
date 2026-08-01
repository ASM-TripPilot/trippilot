package com.trippilot.auth.adapter.out.external

import io.kotest.assertions.throwables.shouldThrow
import io.kotest.core.spec.style.StringSpec
import org.springframework.web.client.RestClient

/**
 * Apple 은 id_token 서명검증(JWKS) 미구현 → fail-closed. 무검증 id_token 신뢰 금지(계정 탈취 방지).
 * 검증 구현 후 이 테스트를 정상 플로우 테스트로 교체.
 */
class AppleOAuthClientTest : StringSpec({

    "fetchProfile 은 검증 구현 전까지 예외로 차단된다(fail-closed)" {
        val client = AppleOAuthClient(SocialProviderProperties(), RestClient.builder())

        shouldThrow<UnsupportedOperationException> {
            client.fetchProfile("code", "verifier", "trippilot://auth")
        }
    }
})
