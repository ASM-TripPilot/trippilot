package com.trippilot.auth.adapter.out.external

import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.shouldBe
import org.hamcrest.Matchers.containsString
import org.hamcrest.Matchers.not
import org.springframework.http.HttpMethod
import org.springframework.http.MediaType
import org.springframework.test.web.client.MockRestServiceServer
import org.springframework.test.web.client.match.MockRestRequestMatchers.content
import org.springframework.test.web.client.match.MockRestRequestMatchers.header
import org.springframework.test.web.client.match.MockRestRequestMatchers.method
import org.springframework.test.web.client.match.MockRestRequestMatchers.requestTo
import org.springframework.test.web.client.response.MockRestResponseCreators.withSuccess
import org.springframework.web.client.RestClient

/**
 * D37 — 외부 제공자 응답을 MockRestServiceServer 로 가짜 처리해 code→token→userinfo 흐름·파싱을 검증.
 * (실제 IdP 호출 0. Google 을 대표로, Kakao/Naver 도 동일 골격.)
 */
class GoogleOAuthClientTest : StringSpec({

    "authorization code 교환 후 userinfo 에서 sub·email 을 파싱한다" {
        val builder = RestClient.builder()
        val server = MockRestServiceServer.bindTo(builder).build()
        val props = SocialProviderProperties(
            google = SocialProviderProperties.ProviderConfig(
                clientId = "client-id",
                clientSecret = "client-secret",
                tokenUri = "https://oauth.example/token",
                userInfoUri = "https://oauth.example/userinfo",
            ),
        )

        server.expect(requestTo("https://oauth.example/token"))
            .andExpect(method(HttpMethod.POST))
            .andExpect(content().string(containsString("client_secret=client-secret")))   // confidential: 시크릿 전송
            .andRespond(withSuccess("""{"access_token":"access-1"}""", MediaType.APPLICATION_JSON))
        server.expect(requestTo("https://oauth.example/userinfo"))
            .andExpect(method(HttpMethod.GET))
            .andExpect(header("Authorization", "Bearer access-1"))
            .andRespond(withSuccess("""{"sub":"google-1","email":"user@example.com"}""", MediaType.APPLICATION_JSON))

        val client = GoogleOAuthClient(props, builder)

        val profile = client.fetchProfile("auth-code", "verifier", "trippilot://auth")

        profile.providerSub shouldBe "google-1"
        profile.email shouldBe "user@example.com"
        server.verify()
    }

    "client_secret 이 비면 토큰 요청에서 생략한다(Google iOS 등 public 클라이언트)" {
        val builder = RestClient.builder()
        val server = MockRestServiceServer.bindTo(builder).build()
        val props = SocialProviderProperties(
            google = SocialProviderProperties.ProviderConfig(
                clientId = "ios-client-id",
                clientSecret = "",                       // public 클라이언트 — 시크릿 없음
                tokenUri = "https://oauth.example/token",
                userInfoUri = "https://oauth.example/userinfo",
            ),
        )

        server.expect(requestTo("https://oauth.example/token"))
            .andExpect(method(HttpMethod.POST))
            .andExpect(content().string(containsString("code_verifier=verifier")))   // PKCE 로 소유증명
            .andExpect(content().string(not(containsString("client_secret"))))       // 시크릿 미전송
            .andRespond(withSuccess("""{"access_token":"access-2"}""", MediaType.APPLICATION_JSON))
        server.expect(requestTo("https://oauth.example/userinfo"))
            .andExpect(method(HttpMethod.GET))
            .andRespond(withSuccess("""{"sub":"google-2","email":"ios@example.com"}""", MediaType.APPLICATION_JSON))

        val client = GoogleOAuthClient(props, builder)

        val profile = client.fetchProfile("auth-code", "verifier", "trippilot://oauth/google")

        profile.providerSub shouldBe "google-2"
        server.verify()
    }
})
