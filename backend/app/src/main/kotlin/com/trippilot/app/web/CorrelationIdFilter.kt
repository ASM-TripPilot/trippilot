package com.trippilot.app.web

import jakarta.servlet.FilterChain
import jakarta.servlet.http.HttpServletRequest
import jakarta.servlet.http.HttpServletResponse
import org.slf4j.MDC
import org.springframework.core.Ordered
import org.springframework.core.annotation.Order
import org.springframework.stereotype.Component
import org.springframework.web.filter.OncePerRequestFilter
import java.util.UUID

/**
 * 필터체인 1단(U1-내부아키텍처 §3.4) — 요청당 상관 ID 생성/전파.
 * 클라이언트가 [HEADER] 를 보내면 재사용, 아니면 생성 → MDC 주입(로그 상관) + 응답 헤더 반환.
 * 비동기 잡·아웃박스 이벤트로의 전파는 각 발행 지점에서 MDC 값을 읽어 넘긴다(계약).
 */
@Component
@Order(Ordered.HIGHEST_PRECEDENCE)
class CorrelationIdFilter : OncePerRequestFilter() {

    override fun doFilterInternal(
        request: HttpServletRequest,
        response: HttpServletResponse,
        filterChain: FilterChain,
    ) {
        val traceId = request.getHeader(HEADER)?.takeIf { it.isNotBlank() } ?: UUID.randomUUID().toString()
        MDC.put(MDC_KEY, traceId)
        response.setHeader(HEADER, traceId)
        try {
            filterChain.doFilter(request, response)
        } finally {
            MDC.remove(MDC_KEY)
        }
    }

    companion object {
        const val MDC_KEY = "traceId"
        const val HEADER = "X-Trace-Id"
    }
}
