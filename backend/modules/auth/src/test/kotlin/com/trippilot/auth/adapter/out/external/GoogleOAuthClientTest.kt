package com.trippilot.auth.adapter.out.external

import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.shouldBe
import org.springframework.http.HttpMethod
import org.springframework.http.MediaType
import org.springframework.test.web.client.MockRestServiceServer
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
})
