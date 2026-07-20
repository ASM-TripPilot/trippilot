package com.trippilot.auth.adapter.out.external

import com.trippilot.auth.application.RefreshTokenProperties
import org.springframework.boot.autoconfigure.condition.ConditionalOnMissingBean
import org.springframework.boot.context.properties.EnableConfigurationProperties
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Configuration
import org.springframework.web.client.RestClient

/** 외부 어댑터 설정 — 소셜 제공자·리프레시 토큰 프로퍼티 바인딩 + OAuth 클라이언트용 RestClient.Builder. */
@Configuration
@EnableConfigurationProperties(SocialProviderProperties::class, RefreshTokenProperties::class)
class AuthExternalConfiguration {

    /** SB4.0 은 RestClient.Builder 를 자동 노출하지 않아 명시 제공(이미 있으면 유지). */
    @Bean
    @ConditionalOnMissingBean
    fun restClientBuilder(): RestClient.Builder = RestClient.builder()
}
