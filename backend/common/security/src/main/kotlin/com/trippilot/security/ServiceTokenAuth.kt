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
 *
 * **두 방향이 한 값을 쓴다.** 수신(``/internal` 하위`)과 발신(백엔드→AI) 모두 이 시크릿이고, 갈라 두면
 * 둘 중 하나만 세팅된 절반 설정이 생겨 **한쪽 방향만 401** 이 나는 상태가 된다.
 *
 * @property requireToken 켜면 **비어 있을 때 기동하지 않는다**. 기본은 꺼짐 — 켜 두면 토큰을 안 넣은
 *  로컬·CI 가 통째로 죽는다. 배포 환경에서 켜는 스위치다(`JWT_REQUIRE_CONFIGURED_KEY` 와 같은 모양).
 *
 *  **왜 필요한가**: 수신은 비면 닫히지만(위) **발신은 비면 헤더를 아예 안 붙이고 그냥 나간다**. 상대가
 *  검증을 켜는 순간 AI 호출이 전부 401 인데, 그중 몇은 `degraded` 폴백으로 흡수돼 "AI 가 좀 이상하다"
 *  로만 보인다 — 원인이 **설정 누락**이라는 사실이 어디에도 안 남는다. 이 스위치가 그 상태를
 *  배포 시점에 드러낸다.
 */
@ConfigurationProperties(prefix = "trippilot.service-auth")
data class ServiceAuthProperties(val token: String = "", val requireToken: Boolean = false)

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

    /**
     * **서비스 경계에서만 동작한다.** 경로를 안 가리면 서비스 토큰이 사용자 API 까지 인증해 버린다 —
     * 계정을 쓰지 않는 엔드포인트(`/api/v1/stays/search`·`geocode`·`reverse-geocode`)는 그대로 통과하고,
     * 그 셋은 벤더(카카오)를 부르므로 토큰이 새면 **쿼터를 태우는 무인증 프록시**가 된다.
     *
     * 나머지 사용자 API 가 401 로 끝나는 것은 `principal.accountId()` 가 "service" 를 UUID 로 읽지 못해서인데,
     * 그건 방어가 아니라 우연이다.
     */
    override fun shouldNotFilter(request: HttpServletRequest): Boolean =
        !request.requestURI.startsWith(PATH_PREFIX)

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

        /** 이 접두사 아래에서만 서비스 인증이 성립한다. `SecurityConfig` 의 인가 규칙과 같은 범위여야 한다. */
        const val PATH_PREFIX = "/internal/"
        private val log = LoggerFactory.getLogger(ServiceTokenAuthFilter::class.java)

        /**
         * 기동 시 1회 — 꺼져 있다는 사실이 로그에 남아야 "왜 401 이 나나"를 되짚을 수 있다.
         *
         * [requireToken] 이 켜져 있으면 **경고가 아니라 기동 실패**다. 경고로 두면 배포 환경이
         * 무인증으로 떠 버리고, 그 사실은 상대가 검증을 켜는 **한참 뒤에** 다른 증상으로 나타난다.
         */
        fun announce(token: String, requireToken: Boolean = false) {
            if (token.isNotBlank()) return
            check(!requireToken) {
                "trippilot.service-auth.require-token=true 인데 서비스 토큰(SERVICE_AUTH_TOKEN)이 비어 있습니다. " +
                    "이 상태로 뜨면 /internal/** 은 닫히고 AI 로 나가는 호출은 헤더 없이 나갑니다."
            }
            log.warn(
                "서비스 인증 토큰(SERVICE_AUTH_TOKEN)이 비어 있습니다 — /internal/** 은 아무도 호출할 수 없고" +
                    "(fail-closed), AI 로 나가는 호출은 **헤더 없이** 나갑니다(fail-open). 상대가 검증을 켜면 401 입니다.",
            )
        }
    }
}
