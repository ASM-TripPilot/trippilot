package com.trippilot.app.config

import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Configuration
import org.springframework.http.HttpMethod
import org.springframework.security.config.annotation.web.builders.HttpSecurity
import org.springframework.security.config.http.SessionCreationPolicy
import org.springframework.security.web.SecurityFilterChain

/**
 * 무상태 리소스 서버 — R6 인증 게이트. 공개 화이트리스트 외 모든 요청은 Bearer JWT 필요.
 *
 * JWT 검증은 common/security 의 JwtDecoder(서명 + iss/aud/exp). 세션·CSRF 없음(토큰 기반, 무상태).
 * 화이트리스트: 헬스체크(compose·actuator) · 통합 프로브 · 소셜 로그인 · 리프레시(자체 검증).
 */
@Configuration
class SecurityConfig {

    @Bean
    fun securityFilterChain(http: HttpSecurity): SecurityFilterChain {
        http
            .csrf { it.disable() }
            .sessionManagement { it.sessionCreationPolicy(SessionCreationPolicy.STATELESS) }
            .authorizeHttpRequests {
                it.requestMatchers(
                    "/api/v1/auth/social/**",  // 소셜 로그인(공개)
                    "/api/v1/auth/token/**",   // 리프레시(공개 — 리프레시 토큰 자체 검증)
                    "/api/v1/auth/logout",     // 로그아웃(공개 — 제시한 리프레시 세션 폐기, 멱등)
                ).permitAll()
                it.requestMatchers("/actuator/health", "/actuator/health/**").permitAll() // compose·k8s 헬스체크
                it.requestMatchers(HttpMethod.GET, "/api/health", "/api/integration").permitAll() // 통합 프로브
                it.anyRequest().authenticated()
            }
            .oauth2ResourceServer { it.jwt { } } // JwtDecoder 빈(common/security) 사용
        return http.build()
    }
}
