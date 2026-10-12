package com.trippilot.auth.adapter.out.external

import com.trippilot.auth.domain.Provider
import com.trippilot.core.error.AuthenticationRequired
import com.trippilot.core.error.ErrorCode
import com.trippilot.core.error.UpstreamUnavailable
import io.kotest.assertions.throwables.shouldThrow
import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.shouldBe
import io.kotest.matchers.string.shouldNotContain
import org.springframework.http.HttpStatus
import org.springframework.http.MediaType
import org.springframework.test.web.client.MockRestServiceServer
import org.springframework.test.web.client.match.MockRestRequestMatchers.header
import org.springframework.test.web.client.match.MockRestRequestMatchers.requestTo
import org.springframework.test.web.client.response.MockRestResponseCreators.withStatus
import org.springframework.test.web.client.response.MockRestResponseCreators.withSuccess
import org.springframework.web.client.RestClient

/**
 * 카카오 SDK 토큰은 **우리 앱에 발급된 것만** 받는다(TRIP-1317).
 *
 * userinfo 는 "이 사람이 누구인가"만 답한다. 남의 카카오 앱이 받은 토큰도 userinfo 를 통과하므로, 대조가
 * 없으면 그 토큰의 이메일로 계정이 만들어지고 본인의 첫 가입이 409 로 막힌다.
 */
class KakaoTokenAudienceTest : StringSpec({

    val tokenInfo = "https://kapi.example/v1/user/access_token_info"
    val userInfo = "https://kapi.example/v2/user/me"

    fun fixture(appId: String): Pair<SocialAuthAdapter, MockRestServiceServer> {
        val builder = RestClient.builder()
        val server = MockRestServiceServer.bindTo(builder).build()
        val props = SocialProviderProperties(
            kakao = SocialProviderProperties.ProviderConfig(appId = appId, tokenInfoUri = tokenInfo, userInfoUri = userInfo),
        )
        return SocialAuthAdapter(listOf(KakaoOAuthClient(props, builder))) to server
    }

    "우리 앱에 발급된 토큰은 프로필까지 간다" {
        val (adapter, server) = fixture("1519823")
        server.expect(requestTo(tokenInfo)).andExpect(header("Authorization", "Bearer sdk-token"))
            .andRespond(withSuccess("""{"id":42,"expires_in":7199,"app_id":1519823}""", MediaType.APPLICATION_JSON))
        server.expect(requestTo(userInfo))
            .andRespond(withSuccess("""{"id":42,"kakao_account":{"email":"me@example.com"}}""", MediaType.APPLICATION_JSON))

        adapter.authenticateWithAccessToken(Provider.KAKAO, "sdk-token").providerSub shouldBe "42"

        server.verify()
    }

    "남의 앱에 발급된 토큰은 401 이고 프로필을 묻지 않는다" {
        val (adapter, server) = fixture("1519823")
        // userinfo 기대를 걸지 않는다 — 대조에서 걸렀는데도 프로필을 물으면 요청 자체가 실패한다.
        server.expect(requestTo(tokenInfo))
            .andRespond(withSuccess("""{"id":42,"expires_in":7199,"app_id":999}""", MediaType.APPLICATION_JSON))

        val thrown = shouldThrow<AuthenticationRequired> { adapter.authenticateWithAccessToken(Provider.KAKAO, "sdk-token") }

        thrown.errorCode shouldBe ErrorCode.SOCIAL_AUTH_FAILED
        // 왜 거절됐는지는 싣지 않는다(SECURITY-15) — 대조 기준을 알려 주지 않는다.
        thrown.message.orEmpty() shouldNotContain "app"
        thrown.message.orEmpty() shouldNotContain "1519823"
        server.verify()
    }

    "발급 앱을 답하지 않는 응답은 거절한다 — 모르면 통과가 아니다" {
        val (adapter, server) = fixture("1519823")
        server.expect(requestTo(tokenInfo))
            .andRespond(withSuccess("""{"id":42,"expires_in":7199}""", MediaType.APPLICATION_JSON))

        shouldThrow<AuthenticationRequired> { adapter.authenticateWithAccessToken(Provider.KAKAO, "sdk-token") }

        server.verify()
    }

    "카카오가 토큰을 무효라 하면 401, 카카오가 죽었으면 503 이다 — 대조 단계도 같은 갈래를 탄다" {
        val (invalid, invalidServer) = fixture("1519823")
        invalidServer.expect(requestTo(tokenInfo)).andRespond(withStatus(HttpStatus.UNAUTHORIZED))
        shouldThrow<AuthenticationRequired> { invalid.authenticateWithAccessToken(Provider.KAKAO, "sdk-token") }

        val (down, downServer) = fixture("1519823")
        downServer.expect(requestTo(tokenInfo)).andRespond(withStatus(HttpStatus.BAD_GATEWAY))
        shouldThrow<UpstreamUnavailable> { down.authenticateWithAccessToken(Provider.KAKAO, "sdk-token") }
    }

    /** 앱 ID 가 주입되지 않은 환경(로컬·키 미발급)은 종전대로 돈다 — 대조 호출 자체가 나가지 않는다. */
    "앱 ID 가 비면 대조하지 않는다" {
        val (adapter, server) = fixture("")
        server.expect(requestTo(userInfo))
            .andRespond(withSuccess("""{"id":42,"kakao_account":{"email":"me@example.com"}}""", MediaType.APPLICATION_JSON))

        adapter.authenticateWithAccessToken(Provider.KAKAO, "sdk-token").providerSub shouldBe "42"

        server.verify()
    }
})
