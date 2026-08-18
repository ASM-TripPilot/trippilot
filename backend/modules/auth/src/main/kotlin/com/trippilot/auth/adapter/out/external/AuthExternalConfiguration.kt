package com.trippilot.auth.adapter.out.external

import com.trippilot.auth.application.RefreshTokenProperties
import org.springframework.boot.autoconfigure.condition.ConditionalOnMissingBean
import org.springframework.boot.context.properties.EnableConfigurationProperties
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Configuration
import org.springframework.http.client.SimpleClientHttpRequestFactory
import org.springframework.web.client.RestClient
import java.time.Duration

/** 외부 어댑터 설정 — 소셜 제공자·리프레시 토큰 프로퍼티 바인딩 + OAuth 클라이언트용 RestClient.Builder. */
@Configuration
@EnableConfigurationProperties(SocialProviderProperties::class, RefreshTokenProperties::class)
class AuthExternalConfiguration {

    /**
     * SB4.0 은 RestClient.Builder 를 자동 노출하지 않아 명시 제공(이미 있으면 유지).
     *
     * **타임아웃이 붙어 있다.** 없으면 IdP 가 죽지 않고 **느려지기만 해도** 로그인 요청 스레드가 무한히 물린다.
     * 이 빌더는 in-place 변형이라 주입받는 쪽이 baseUrl 을 걸면 나머지가 오염된다 — 그래서 소비자는
     * **OAuth 클라이언트 4종뿐**이고, 카카오 로컬·AI 경계는 각자 전용 클라이언트를 따로 만든다.
     */
    @Bean
    @ConditionalOnMissingBean
    fun restClientBuilder(): RestClient.Builder = restClientBuilder(CONNECT_TIMEOUT, READ_TIMEOUT)

    /**
     * 생성 경로 — `@Bean` 은 운영 상수로, 테스트는 짧은 값으로 **같은 코드**를 태운다.
     * 타임아웃은 실제 소켓에서만 드러나므로 `MockRestServiceServer` 로는 검증할 수 없다.
     */
    internal fun restClientBuilder(connectTimeout: Duration, readTimeout: Duration): RestClient.Builder =
        RestClient.builder()
            .requestFactory(
                SimpleClientHttpRequestFactory().apply {
                    setConnectTimeout(connectTimeout)
                    setReadTimeout(readTimeout)
                },
            )

    companion object {
        /** 연결까지 3초 — 붙지 않는 IdP 는 빨리 포기한다. */
        internal val CONNECT_TIMEOUT: Duration = Duration.ofSeconds(3)

        /** 응답까지 5초. token 교환·userinfo 는 단순 왕복이라 이보다 오래 걸리면 정상이 아니다. */
        internal val READ_TIMEOUT: Duration = Duration.ofSeconds(5)
    }
}
