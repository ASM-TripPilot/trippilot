package com.trippilot.auth.adapter.out.external

import com.trippilot.auth.domain.Provider
import com.trippilot.core.error.AuthenticationRequired
import com.trippilot.core.error.ErrorCode
import io.kotest.assertions.throwables.shouldThrow
import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.shouldBe
import io.kotest.matchers.string.shouldNotContain
import org.hamcrest.Matchers.containsString
import org.hamcrest.Matchers.not
import org.springframework.http.HttpMethod
import org.springframework.http.HttpStatus
import org.springframework.http.MediaType
import org.springframework.test.web.client.MockRestServiceServer
import org.springframework.test.web.client.match.MockRestRequestMatchers.content
import org.springframework.test.web.client.match.MockRestRequestMatchers.method
import org.springframework.test.web.client.match.MockRestRequestMatchers.requestTo
import org.springframework.test.web.client.response.MockRestResponseCreators.withStatus
import org.springframework.test.web.client.response.MockRestResponseCreators.withSuccess
import org.springframework.web.client.RestClient

/**
 * 구글 웹 클라이언트 선택(TRIP-1656) — redirectUri 가 허용 웹 출처 + `/oauth/google` 이면 웹 클라이언트(시크릿 포함)로,
 * 앱 커스텀 스킴이면 지금처럼 iOS 클라이언트로 교환한다. 목록 밖 웹 주소는 교환하지 않는다(열린 redirect 금지).
 * 실제 IdP 호출 0 — MockRestServiceServer.
 */
class GoogleWebClientSelectionTest : StringSpec({

    val webSecret = "web-secret-DO-NOT-LOG"

    fun props(webClientId: String = "web-client-id", origins: String = "https://app.example.test,http://localhost:8081") =
        SocialProviderProperties(
            google = SocialProviderProperties.ProviderConfig(
                clientId = "ios-client-id",
                tokenUri = "https://ios.example/token",
                userInfoUri = "https://oauth.example/userinfo",
            ),
            googleWeb = SocialProviderProperties.ProviderConfig(
                clientId = webClientId,
                clientSecret = webSecret,
                tokenUri = "https://web.example/token",
                userInfoUri = "https://oauth.example/userinfo",
                redirectOrigins = origins,
            ),
        )

    fun expectUserInfo(server: MockRestServiceServer) {
        server.expect(requestTo("https://oauth.example/userinfo"))
            .andExpect(method(HttpMethod.GET))
            .andRespond(withSuccess("""{"sub":"google-web-1","email":"web@example.com"}""", MediaType.APPLICATION_JSON))
    }

    "웹 redirectUri 는 웹 클라이언트 ID·시크릿으로 교환한다" {
        val builder = RestClient.builder()
        val server = MockRestServiceServer.bindTo(builder).build()
        server.expect(requestTo("https://web.example/token"))
            .andExpect(method(HttpMethod.POST))
            .andExpect(content().string(containsString("client_id=web-client-id")))
            .andExpect(content().string(containsString("client_secret=$webSecret")))
            .andExpect(content().string(containsString("redirect_uri=https%3A%2F%2Fapp.example.test%2Foauth%2Fgoogle")))
            .andRespond(withSuccess("""{"access_token":"web-access"}""", MediaType.APPLICATION_JSON))
        expectUserInfo(server)

        val profile = GoogleOAuthClient(props(), builder).fetchProfile("code", "verifier", "https://app.example.test/oauth/google")

        profile.providerSub shouldBe "google-web-1"
        server.verify()
    }

    "로컬 개발 출처(http://localhost)도 허용 목록에 있으면 웹 클라이언트로 교환한다" {
        val builder = RestClient.builder()
        val server = MockRestServiceServer.bindTo(builder).build()
        server.expect(requestTo("https://web.example/token"))
            .andExpect(content().string(containsString("client_id=web-client-id")))
            .andRespond(withSuccess("""{"access_token":"web-access"}""", MediaType.APPLICATION_JSON))
        expectUserInfo(server)

        GoogleOAuthClient(props(), builder).fetchProfile("code", "verifier", "http://localhost:8081/oauth/google")
        server.verify()
    }

    "앱 커스텀 스킴 redirectUri 는 지금처럼 iOS 클라이언트로, 시크릿 없이 교환한다" {
        val builder = RestClient.builder()
        val server = MockRestServiceServer.bindTo(builder).build()
        server.expect(requestTo("https://ios.example/token"))
            .andExpect(content().string(containsString("client_id=ios-client-id")))
            .andExpect(content().string(not(containsString("client_secret"))))
            .andRespond(withSuccess("""{"access_token":"ios-access"}""", MediaType.APPLICATION_JSON))
        expectUserInfo(server)

        GoogleOAuthClient(props(), builder).fetchProfile("code", "verifier", "trippilot://oauth/google")
        server.verify()
    }

    "허용 목록 밖 웹 redirectUri 는 교환하지 않고 401 이다" {
        listOf(
            "https://evil.example.test/oauth/google",          // 목록 밖 출처
            "https://app.example.test/oauth/google/../x",       // 경로 변형
            "https://app.example.test/oauth/kakao",             // 다른 제공자 경로
            "https://app.example.test.evil.test/oauth/google",  // 접미 도메인
            "HTTPS://evil.example.test/oauth/google",           // 대문자 스킴으로 앱 분기 우회 시도
        ).forEach { redirect ->
            val builder = RestClient.builder()
            val server = MockRestServiceServer.bindTo(builder).build() // 기대 0 — 아웃바운드가 나가면 실패

            val e = shouldThrow<AuthenticationRequired> {
                GoogleOAuthClient(props(), builder).fetchProfile("code", "verifier", redirect)
            }
            e.errorCode shouldBe ErrorCode.SOCIAL_AUTH_FAILED
            server.verify()
        }
    }

    "허용 출처의 http 는 루프백만 받는다 — 운영 출처를 http 로 적어도 웹 교환이 열리지 않는다" {
        GoogleOAuthClient.webRedirectUris("http://app.example.test, https://a.test/ ,http://127.0.0.1:19006") shouldBe
            setOf("https://a.test/oauth/google", "http://127.0.0.1:19006/oauth/google")
        GoogleOAuthClient.webRedirectUris("") shouldBe emptySet()
    }

    "웹 클라이언트가 미설정이면 웹 교환은 401 이고 iOS 클라이언트로 새지 않는다" {
        val builder = RestClient.builder()
        val server = MockRestServiceServer.bindTo(builder).build()

        val e = shouldThrow<AuthenticationRequired> {
            GoogleOAuthClient(props(webClientId = ""), builder).fetchProfile("code", "verifier", "https://app.example.test/oauth/google")
        }
        e.errorCode shouldBe ErrorCode.SOCIAL_AUTH_FAILED
        server.verify()
    }

    "교환 실패의 예외·설정 문자열에 웹 client_secret 이 남지 않는다(SECURITY-15)" {
        val builder = RestClient.builder()
        val server = MockRestServiceServer.bindTo(builder).build()
        server.expect(requestTo("https://web.example/token"))
            .andRespond(withStatus(HttpStatus.BAD_REQUEST).contentType(MediaType.APPLICATION_JSON).body("""{"error":"invalid_grant"}"""))
        val p = props()
        val adapter = SocialAuthAdapter(listOf(GoogleOAuthClient(p, builder)))

        val e = shouldThrow<AuthenticationRequired> {
            adapter.exchange(Provider.GOOGLE, "code", "verifier", "https://app.example.test/oauth/google")
        }
        e.errorCode shouldBe ErrorCode.SOCIAL_AUTH_FAILED
        generateSequence<Throwable>(e) { it.cause }.forEach {
            it.toString() shouldNotContain webSecret
            it.stackTraceToString() shouldNotContain webSecret
        }
        p.toString() shouldNotContain webSecret
    }
})
