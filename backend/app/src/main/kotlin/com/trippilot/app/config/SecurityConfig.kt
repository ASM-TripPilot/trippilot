package com.trippilot.app.config

import com.fasterxml.jackson.databind.ObjectMapper
import com.trippilot.app.web.error.requestRejectedBody
import com.trippilot.security.ServiceAuthProperties
import com.trippilot.security.ServiceAuthenticationToken
import com.trippilot.security.ServiceTokenAuthFilter
import jakarta.servlet.http.HttpServletResponse
import org.slf4j.LoggerFactory
import org.springframework.boot.context.properties.EnableConfigurationProperties
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Configuration
import org.springframework.http.HttpMethod
import org.springframework.http.MediaType
import org.springframework.security.config.annotation.web.builders.HttpSecurity
import org.springframework.security.config.http.SessionCreationPolicy
import org.springframework.security.oauth2.server.resource.web.authentication.BearerTokenAuthenticationFilter
import org.springframework.security.web.SecurityFilterChain
import org.springframework.security.web.firewall.RequestRejectedHandler

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
        ServiceTokenAuthFilter.announce(serviceAuth.token, serviceAuth.requireToken)
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
                // 아웃바운드 302(인증 선택) — 브라우저·커스텀탭이 열므로 Authorization 을 실을 수 없다
                // (칸 3 어트리뷰션 표준이 Custom Tab/SFSafariVC 다). 토큰이 오면 계정이 클릭에 남고,
                // 없으면 익명 클릭 — 익명도 "운영 중인 매체" 증거는 된다.
                it.requestMatchers(HttpMethod.GET, "/api/v1/stays/*/outbound").permitAll()
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

    /**
     * 필터 체인에서 방화벽이 거부한 요청(경로의 `;`·`//`·`%25`·`..` 등)을 **400 봉투**로 낸다(TRIP-1473).
     *
     * 이 빈이 없으면 기본 처리가 `sendError(400)` 을 하고, 그 오류 디스패치가 `/error` 로 가면서 인증 필터를 다시 타지
     * 않아 **401** 로 나갔다(실측: 유효 토큰을 실어도 `GET /api/v1/regions;x=1` → 401, 본문 없음). 클라이언트는 그것을
     * 토큰 만료로 읽고 재로그인으로 간다. 여기서 직접 응답을 쓰면 오류 디스패치가 생기지 않는다.
     * 거부 사유(예외 메시지)에는 경로 원문이 실려 있어 싣지 않는다(SECURITY-15).
     *
     * 경로의 `%00`·`%2F`·`%5C` 는 이보다 앞에서 Tomcat 이 400(HTML)으로 막는다 — 스프링 밖이라 봉투를 못 씌운다.
     */
    @Bean
    fun requestRejectedHandler(mapper: ObjectMapper): RequestRejectedHandler = RequestRejectedHandler { _, response, _ ->
        log.warn("방화벽이 요청을 거부했습니다(경로) — 원문은 싣지 않습니다")
        response.status = HttpServletResponse.SC_BAD_REQUEST
        response.contentType = MediaType.APPLICATION_JSON_VALUE
        response.characterEncoding = Charsets.UTF_8.name()
        mapper.writeValue(response.outputStream, requestRejectedBody())
    }

    private companion object {
        private val log = LoggerFactory.getLogger(SecurityConfig::class.java)
    }
}
