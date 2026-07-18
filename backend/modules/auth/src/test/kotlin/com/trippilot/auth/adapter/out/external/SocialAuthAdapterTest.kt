package com.trippilot.auth.adapter.out.external

import com.trippilot.auth.domain.Provider
import com.trippilot.auth.domain.SocialProfile
import com.trippilot.core.error.AuthenticationRequired
import com.trippilot.core.error.ErrorCode
import io.kotest.assertions.throwables.shouldThrow
import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.shouldBe

private class FakeClient(
    override val provider: Provider,
    val result: () -> SocialProfile,
) : OAuthProviderClient {
    override fun fetchProfile(authorizationCode: String, codeVerifier: String, redirectUri: String) = result()
}

class SocialAuthAdapterTest : StringSpec({

    val profile = SocialProfile(Provider.KAKAO, "sub-1", "user@example.com")

    "provider 로 올바른 클라이언트에 디스패치한다" {
        val adapter = SocialAuthAdapter(listOf(FakeClient(Provider.KAKAO) { profile }))

        adapter.exchange(Provider.KAKAO, "code", "verifier", "redirect") shouldBe profile
    }

    "미지원 provider 는 SOCIAL_AUTH_FAILED(401)로 일반화한다" {
        val adapter = SocialAuthAdapter(emptyList())

        val ex = shouldThrow<AuthenticationRequired> {
            adapter.exchange(Provider.GOOGLE, "code", "verifier", "redirect")
        }
        ex.errorCode shouldBe ErrorCode.SOCIAL_AUTH_FAILED
    }

    "클라이언트 실패는 원인 비노출로 SOCIAL_AUTH_FAILED 로 일반화한다" {
        val adapter = SocialAuthAdapter(listOf(FakeClient(Provider.NAVER) { throw RuntimeException("provider 5xx") }))

        val ex = shouldThrow<AuthenticationRequired> {
            adapter.exchange(Provider.NAVER, "code", "verifier", "redirect")
        }
        ex.errorCode shouldBe ErrorCode.SOCIAL_AUTH_FAILED
    }
})
