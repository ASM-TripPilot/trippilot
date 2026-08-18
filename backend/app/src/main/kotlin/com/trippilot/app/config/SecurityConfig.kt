package com.trippilot.app.config

import com.trippilot.security.ServiceAuthProperties
import com.trippilot.security.ServiceAuthenticationToken
import com.trippilot.security.ServiceTokenAuthFilter
import org.springframework.boot.context.properties.EnableConfigurationProperties
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Configuration
import org.springframework.http.HttpMethod
import org.springframework.security.config.annotation.web.builders.HttpSecurity
import org.springframework.security.config.http.SessionCreationPolicy
import org.springframework.security.oauth2.server.resource.web.authentication.BearerTokenAuthenticationFilter
import org.springframework.security.web.SecurityFilterChain

/**
 * 무상태 리소스 서버 — R6 인증 게이트. 공개 화이트리스트 외 모든 요청은 Bearer JWT 필요.
 *
 * JWT 검증은 common/security 의 JwtDecoder(서명 + iss/aud/exp). 세션·CSRF 없음(토큰 기반, 무상태).
 * 화이트리스트: 헬스체크(compose·actuator) · 통합 프로브 · 소셜 로그인 · 리프레시(자체 검증).
 */
@Configuration
@EnableConfigurationProperties(ServiceAuthProperties::class)
class SecurityConfig {

    @Bean
    fun securityFilterChain(http: HttpSecurity, serviceAuth: ServiceAuthProperties): SecurityFilterChain {
        ServiceTokenAuthFilter.announce(serviceAuth.token)
        http
            .csrf { it.disable() }
            .sessionManagement { it.sessionCreationPolicy(SessionCreationPolicy.STATELESS) }
            .authorizeHttpRequests {
                it.requestMatchers(
                    "/api/v1/auth/social/**",  // 소셜 로그인(공개)
                    "/api/v1/auth/token/**",   // 리프레시(공개 — 리프레시 토큰 자체 검증)
                    "/api/v1/auth/logout",     // 로그아웃(공개 — 제시한 리프레시 세션 폐기, 멱등)
                ).permitAll()
                it.requestMatchers(HttpMethod.GET, "/api/v1/terms", "/api/v1/terms/**").permitAll() // 약관 열람(공개, 온보딩 표시)
                // 앱 기동 분기(인증 선택 — 무토큰=GUEST, 유효토큰=AUTHENTICATED). 단, 만료·무효 토큰을 보내면
                // 리소스서버가 401(GUEST 폴백 아님) — 클라는 부트스트랩 전 토큰 갱신/제거 권장(관대한 처리는 후속).
                it.requestMatchers(HttpMethod.GET, "/api/v1/bootstrap").permitAll()
                it.requestMatchers("/actuator/health", "/actuator/health/**").permitAll() // compose·k8s 헬스체크
                it.requestMatchers(HttpMethod.GET, "/api/health", "/api/integration").permitAll() // 통합 프로브
                // API 문서(Swagger UI·스펙·정적 자산) — 로컬/개발 열람용(프로덕션은 프로파일로 차단 권장)
                it.requestMatchers(HttpMethod.GET, "/swagger-ui.html", "/openapi.yaml", "/webjars/**").permitAll()
                // 서비스 경계(AI 등) — **사용자 JWT 로는 통과하지 못한다**(TRIP-393).
                // 계정 스코프가 없는 호출이라 사용자 토큰을 흉내 내면 감사 로그의 "누가 했나"가 거짓이 된다.
                it.requestMatchers("/internal/**").hasAuthority(ServiceAuthenticationToken.ROLE)
                it.anyRequest().authenticated()
            }
            .oauth2ResourceServer { it.jwt { } } // JwtDecoder 빈(common/security) 사용
            // JWT 인증보다 **앞에** 둔다 — 서비스 토큰이 맞으면 그 인증으로 확정하고, 아니면 손대지 않아
            // 뒤의 JWT 판정이 그대로 돈다.
            .addFilterBefore(ServiceTokenAuthFilter(serviceAuth.token), BearerTokenAuthenticationFilter::class.java)
        return http.build()
    }
}
