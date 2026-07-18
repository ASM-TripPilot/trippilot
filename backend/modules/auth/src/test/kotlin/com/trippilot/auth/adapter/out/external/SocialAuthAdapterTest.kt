package com.trippilot.auth.adapter.out.external

import com.trippilot.auth.domain.Provider
import com.trippilot.auth.domain.SocialProfile
import com.trippilot.core.error.AuthenticationRequired
import com.trippilot.core.error.ErrorCode
import com.trippilot.core.error.UpstreamUnavailable
import io.kotest.assertions.throwables.shouldThrow
import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.shouldBe
import org.springframework.http.HttpStatus
import org.springframework.web.client.HttpServerErrorException
import org.springframework.web.client.ResourceAccessException

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

    "클라이언트의 일반 실패(4xx·파싱 등)는 SOCIAL_AUTH_FAILED(401)로 일반화한다" {
        val adapter = SocialAuthAdapter(listOf(FakeClient(Provider.NAVER) { throw RuntimeException("파싱 실패") }))

        val ex = shouldThrow<AuthenticationRequired> {
            adapter.exchange(Provider.NAVER, "code", "verifier", "redirect")
        }
        ex.errorCode shouldBe ErrorCode.SOCIAL_AUTH_FAILED
    }

    "제공자 5xx 는 UpstreamUnavailable(503)로 구분한다 (자격 문제 아님)" {
        val adapter = SocialAuthAdapter(
            listOf(FakeClient(Provider.KAKAO) { throw HttpServerErrorException(HttpStatus.BAD_GATEWAY) }),
        )

        shouldThrow<UpstreamUnavailable> { adapter.exchange(Provider.KAKAO, "code", "verifier", "redirect") }
    }

    "연결 실패·타임아웃도 UpstreamUnavailable(503)" {
        val adapter = SocialAuthAdapter(
            listOf(FakeClient(Provider.GOOGLE) { throw ResourceAccessException("connect timed out") }),
        )

        shouldThrow<UpstreamUnavailable> { adapter.exchange(Provider.GOOGLE, "code", "verifier", "redirect") }
    }
})
