package com.trippilot.auth.adapter.out.external

import com.trippilot.core.error.ErrorCode
import com.trippilot.core.error.ProviderNotSupported
import io.kotest.assertions.throwables.shouldThrow
import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.shouldBe
import io.kotest.matchers.string.shouldNotContain
import org.springframework.web.client.RestClient

/**
 * Apple 은 id_token 서명검증(JWKS) 미구현 → **fail-closed**. 무검증 id_token 을 신뢰하면 위조 sub 로
 * 계정 탈취가 가능하다. 검증 구현 후 이 테스트를 정상 플로우 테스트로 교체한다.
 *
 * ## 예외 타입이 바뀐 이유(TRIP-249)
 *
 * 전에는 `UnsupportedOperationException` 이었고, 어댑터가 그것을 401 `SOCIAL_AUTH_FAILED` 로
 * 일반화했다. 안전 판단은 맞지만 **앱이 "애플은 아직 준비 중"을 안내할 수 없었다** — 사용자에게는
 * 자격 증명이 틀린 것처럼 보이고, 다시 시도하면 또 실패한다(재시도로 풀리지 않는 상태다).
 *
 * 그래서 타입화한 [ProviderNotSupported](501)로 바꿨다. **차단 자체는 그대로다.**
 */
class AppleOAuthClientTest : StringSpec({

    fun client() = AppleOAuthClient(SocialProviderProperties(), RestClient.builder())

    "fetchProfile 은 검증 구현 전까지 차단된다(fail-closed)" {
        val ex = shouldThrow<ProviderNotSupported> {
            client().fetchProfile("code", "verifier", "trippilot://auth")
        }

        // 401 이 아니라 501 로 나가는 근거가 이 코드다 — 화면이 "준비 중"과 "인증 실패"를 가른다.
        ex.errorCode shouldBe ErrorCode.PROVIDER_NOT_SUPPORTED
    }

    "access token 흐름도 차단된다 — Apple 은 userinfo 엔드포인트가 없다" {
        shouldThrow<ProviderNotSupported> { client().fetchProfileByAccessToken("token") }
    }

    "메시지에 내부 사정을 싣지 않는다 — 노출하는 것은 가용성뿐이다(SECURITY-15)" {
        val message = shouldThrow<ProviderNotSupported> {
            client().fetchProfile("code", "verifier", "trippilot://auth")
        }.message.orEmpty()

        // JWKS 미구현 같은 구현 상태를 알려 주면 공격자에게 힌트가 된다.
        message shouldNotContain "JWKS"
        message shouldNotContain "서명"
    }
})
