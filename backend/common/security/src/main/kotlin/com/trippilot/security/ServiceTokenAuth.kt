package com.trippilot.security

import jakarta.servlet.FilterChain
import jakarta.servlet.http.HttpServletRequest
import jakarta.servlet.http.HttpServletResponse
import org.slf4j.LoggerFactory
import org.springframework.boot.context.properties.ConfigurationProperties
import org.springframework.security.authentication.AbstractAuthenticationToken
import org.springframework.security.core.authority.SimpleGrantedAuthority
import org.springframework.security.core.context.SecurityContextHolder
import org.springframework.web.filter.OncePerRequestFilter
import java.security.MessageDigest
import java.nio.charset.StandardCharsets

/**
 * 서비스 간 호출 자격증명(TRIP-393).
 *
 * [token] 이 비어 있으면 서비스 인증이 **꺼진 것**이고, 그 경우 `/internal` 하위 경로는 아무도 통과하지 못한다
 * (fail-closed). 설정을 잊었을 때 조용히 열리는 것보다 조용히 닫히는 편이 안전하다 — 열려 있으면
 * 아무나 POI 정본을 쓸 수 있다.
 */
@ConfigurationProperties(prefix = "trippilot.service-auth")
data class ServiceAuthProperties(val token: String = "")

/** 서비스 호출 주체 — 계정이 없다. [name] 이 감사 로그에 사용자 id 처럼 보이지 않게 고정 문자열이다. */
class ServiceAuthenticationToken : AbstractAuthenticationToken(listOf(SimpleGrantedAuthority(ROLE))) {
    init {
        isAuthenticated = true
    }

    override fun getCredentials(): Any? = null
    override fun getPrincipal(): Any = PRINCIPAL

    companion object {
        const val ROLE = "ROLE_SERVICE"

        /** 계정 UUID 가 아니다 — 이 값이 계정으로 해석되지 않도록 일부러 형식을 다르게 둔다. */
        const val PRINCIPAL = "service"
    }
}

/**
 * `X-Service-Token` 헤더로 서비스 호출을 인증한다.
 *
 * **사용자 JWT 와 섞지 않는다.** 서비스 호출에는 계정 스코프가 없어, 사용자 토큰을 흉내 내면
 * 감사 로그의 "누가 했나"가 거짓이 된다. 그래서 별도 권한([ServiceAuthenticationToken.ROLE])을 부여하고,
 * `/internal` 하위 경로는 그 권한만 받는다.
 *
 * 헤더가 없거나 틀리면 **아무것도 하지 않는다** — 인증을 세우지 않고 넘겨, 뒤의 인가 규칙이 401·403 을 낸다.
 * 여기서 직접 응답을 쓰면 다른 경로(사용자 JWT)의 판정까지 가로챈다.
 */
class ServiceTokenAuthFilter(private val expected: String) : OncePerRequestFilter() {

    override fun doFilterInternal(request: HttpServletRequest, response: HttpServletResponse, chain: FilterChain) {
        val presented = request.getHeader(HEADER)
        if (expected.isNotBlank() && !presented.isNullOrBlank() && matches(presented)) {
            SecurityContextHolder.getContext().authentication = ServiceAuthenticationToken()
        }
        chain.doFilter(request, response)
    }

    /**
     * 상수 시간 비교 — 일반 `==` 는 앞자리부터 다른 순간 멈춰, 응답 시간 차이로 토큰을 한 글자씩 맞출 수 있다.
     * 길이가 달라도 비교를 끝까지 수행하도록 해시를 비교한다.
     */
    private fun matches(presented: String): Boolean =
        MessageDigest.isEqual(sha256(presented), sha256(expected))

    private fun sha256(v: String): ByteArray =
        MessageDigest.getInstance("SHA-256").digest(v.toByteArray(StandardCharsets.UTF_8))

    companion object {
        const val HEADER = "X-Service-Token"
        private val log = LoggerFactory.getLogger(ServiceTokenAuthFilter::class.java)

        /** 기동 시 1회 — 꺼져 있다는 사실이 로그에 남아야 "왜 401 이 나나"를 되짚을 수 있다. */
        fun announce(token: String) {
            if (token.isBlank()) {
                log.warn(
                    "서비스 인증 토큰(SERVICE_AUTH_TOKEN)이 비어 있습니다 — /internal/** 은 아무도 호출할 수 없습니다(fail-closed).",
                )
            }
        }
    }
}
