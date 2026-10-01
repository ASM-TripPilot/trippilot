package com.trippilot.auth.adapter.out.external

import com.trippilot.auth.domain.Provider
import com.trippilot.core.error.ErrorCode
import com.trippilot.core.error.ProviderNotSupported
import io.kotest.assertions.throwables.shouldThrow
import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.shouldBe
import io.kotest.matchers.string.shouldContain
import io.kotest.matchers.string.shouldNotContain
import org.springframework.http.MediaType
import org.springframework.test.web.client.MockRestServiceServer
import org.springframework.test.web.client.match.MockRestRequestMatchers.requestTo
import org.springframework.test.web.client.response.MockRestResponseCreators.withSuccess
import org.springframework.web.client.RestClient

/**
 * **키가 없는 제공자는 401 이 아니라 501 이다.**
 *
 * 종전에는 빈 `client_id` 로 IdP 를 **실제로 호출**했고, 제공자의 4xx 를 [SocialAuthAdapter] 가
 * 401 `SOCIAL_AUTH_FAILED` 로 일반화했다. 그러면 앱이 "다시 시도"를 권하고 사용자는 같은 실패를
 * 반복한다 — 재시도로 풀리지 않는 상태다(TRIP-249 가 Apple 에 대해 정확히 이 판단을 했다).
 *
 * 여기서 재는 것은 두 가지다: **상태코드가 갈리는가**, 그리고 **아웃바운드가 아예 안 나가는가**.
 * 뒤엣것이 없으면 "막았다"가 아니라 "막은 척"이다 — 미설정 환경에서 사용자가 버튼을 누를 때마다
 * 쓸모없는 IdP 호출이 나간다.
 */
class UnconfiguredProviderGuardTest : StringSpec({

    /** 키가 하나도 없는 설정 — 실 환경의 "아직 발급 안 받음" 상태 그대로다. */
    fun unconfigured() = SocialProviderProperties()

    /**
     * 기대 문구를 **리터럴로 적는다.** `provider.displayName` 으로 비교하면 구현이 만든 값을 구현으로
     * 되묻는 동어반복이라, 이름을 아무거나로 바꿔도 초록이다(역검증 실측 — 그 상태였다).
     */
    "구글·카카오·네이버 모두 미설정이면 501 이고, 어느 제공자인지 말한다" {
        val clients = listOf(
            Triple("구글", Provider.GOOGLE, GoogleOAuthClient(unconfigured(), RestClient.builder())),
            Triple("카카오", Provider.KAKAO, KakaoOAuthClient(unconfigured(), RestClient.builder())),
            Triple("네이버", Provider.NAVER, NaverOAuthClient(unconfigured(), RestClient.builder())),
        )

        clients.forEach { (expectedName, provider, client) ->
            val thrown = shouldThrow<ProviderNotSupported> {
                client.fetchProfile("code", "verifier", "trippilot://auth")
            }

            thrown.errorCode shouldBe ErrorCode.PROVIDER_NOT_SUPPORTED
            // 어느 제공자가 준비 중인지는 화면이 말해 줄 수 있어야 한다.
            thrown.message.orEmpty() shouldContain expectedName
            client.provider shouldBe provider
        }
    }

    "미설정이면 IdP 를 **부르지 않는다** — 막은 척이 아니다" {
        // 서버에 아무 기대도 걸지 않는다. 한 번이라도 나가면 요청 자체가 실패한다.
        val builder = RestClient.builder()
        val server = MockRestServiceServer.bindTo(builder).build()
        val client = GoogleOAuthClient(unconfigured(), builder)

        shouldThrow<ProviderNotSupported> { client.fetchProfile("code", "verifier", "trippilot://auth") }

        server.verify() // 기대 0건 = 호출 0건
    }

    /**
     * **SDK 토큰 흐름은 가드 대상이 아니다.** 그 경로는 `clientId` 를 쓰지 않는다 — 소유증명은
     * 앱이 네이티브 SDK 에서 받아 온 토큰이 하고 서버는 userinfo 만 묻는다. 여기까지 막으면
     * `userInfoUri` 만 설정된 정상 배치를 막게 된다(`GoogleOAuthClientTest` 가 그 배치를 쓴다).
     * 이 테스트는 가드를 그쪽으로 넓히려는 다음 사람을 세운다.
     */
    "SDK 토큰 흐름은 clientId 가 없어도 막지 않는다" {
        val builder = RestClient.builder()
        val server = MockRestServiceServer.bindTo(builder).build()
        val props = SocialProviderProperties(
            naver = SocialProviderProperties.ProviderConfig(
                userInfoUri = "https://openapi.example/v1/nid/me", // clientId 는 일부러 비운다
            ),
        )
        server.expect(requestTo("https://openapi.example/v1/nid/me"))
            .andRespond(
                withSuccess(
                    """{"response":{"id":"naver-1","email":"user@example.com"}}""",
                    MediaType.APPLICATION_JSON,
                ),
            )

        val profile = NaverOAuthClient(props, builder).fetchProfileByAccessToken("sdk-token")

        profile.providerSub shouldBe "naver-1"
        server.verify()
    }

    "어댑터를 지나도 401 로 뭉개지지 않는다" {
        // SocialAuthAdapter 는 DomainException 을 그대로 올린다 — 그 계약이 유지되는지까지 본다.
        val adapter = SocialAuthAdapter(listOf(KakaoOAuthClient(unconfigured(), RestClient.builder())))

        val ex = shouldThrow<ProviderNotSupported> {
            adapter.exchange(Provider.KAKAO, "code", "verifier", "trippilot://auth")
        }
        ex.errorCode shouldBe ErrorCode.PROVIDER_NOT_SUPPORTED
    }


    "메시지에 내부 사정을 싣지 않는다 (SECURITY-15)" {
        val message = shouldThrow<ProviderNotSupported> {
            NaverOAuthClient(unconfigured(), RestClient.builder()).fetchProfile("c", "v", "trippilot://auth")
        }.message.orEmpty()

        message shouldNotContain "clientId"
        message shouldNotContain "client_id"
        message shouldNotContain "미발급"
    }
})
