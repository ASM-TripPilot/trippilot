package com.trippilot.placedata.adapter.out.external

import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Configuration
import org.springframework.http.client.SimpleClientHttpRequestFactory
import org.springframework.web.client.RestClient
import java.time.Duration

/**
 * 카카오 로컬 전용 RestClient — **kakao 모드에서만 활성**(어댑터 2종과 같은 스위치).
 *
 * **공유 `RestClient.Builder` 빈(auth 모듈 제공)을 쓰지 않는다.** 그 빌더는 in-place 변형이라 주입받은 쪽이
 * `baseUrl` 을 걸면 같은 인스턴스를 쓰는 OAuth 클라이언트까지 물려받는다. 지금은 OAuth 가 절대 URI 를 써서
 * 우연히 안 터질 뿐이다. AI 경계도 같은 이유로 전용 빌더를 따로 만든다([ScheduleAgentConfiguration] 참조).
 *
 * **타임아웃이 이 설정의 존재 이유다.** 없으면 벤더가 죽지 않고 **느려지기만 해도** 호출 스레드가 무한히 물린다 —
 * 죽은 벤더보다 느린 벤더가 위험하다. 지역 판정·숙소 검색은 단순 조회라 상한을 짧게 잡는다.
 *
 * 두 어댑터(지역 지오코딩·장소 검색)가 같은 벤더·같은 호스트·같은 키라 클라이언트 하나를 공유한다.
 */
@Configuration
@ConditionalOnProperty(name = ["trippilot.place.geocode.mode"], havingValue = "kakao")
class KakaoLocalClientConfiguration {

    @Bean(BEAN_NAME)
    fun kakaoLocalRestClient(): RestClient = build(CONNECT_TIMEOUT, READ_TIMEOUT)

    /**
     * 생성 경로 — `@Bean` 은 운영 상수로, 테스트는 짧은 값으로 **같은 코드**를 태운다.
     * 타임아웃은 실제 소켓에서만 드러나므로 `MockRestServiceServer` 로는 검증할 수 없다.
     */
    internal fun build(connectTimeout: Duration, readTimeout: Duration): RestClient =
        RestClient.builder()
            .baseUrl(BASE_URL)
            .requestFactory(
                SimpleClientHttpRequestFactory().apply {
                    setConnectTimeout(connectTimeout)
                    setReadTimeout(readTimeout)
                },
            )
            .build()

    companion object {
        /** 컨텍스트에 다른 `RestClient` 빈(AI 경계)이 있어 주입은 이름으로 못박는다. */
        const val BEAN_NAME = "kakaoLocalRestClient"

        internal const val BASE_URL = "https://dapi.kakao.com"

        /** 연결까지 3초 — 붙지 않는 상대는 빨리 포기한다. */
        internal val CONNECT_TIMEOUT: Duration = Duration.ofSeconds(3)

        /** 응답까지 5초. 지역 판정·장소 검색은 단순 조회라 이보다 오래 걸리면 정상이 아니다. */
        internal val READ_TIMEOUT: Duration = Duration.ofSeconds(5)
    }
}
