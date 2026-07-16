package com.trippilot.app.web

import org.springframework.beans.factory.annotation.Value
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.RestController
import org.springframework.web.client.RestClient

/**
 * 컨테이너 통합 테스트용 — BE 가 compose 네트워크로 AI 컨테이너(`ai:8000`)에 닿는지 확인.
 * AI_URL 미설정(로컬 bootRun 등)이면 우아하게 degrade. 실제 AI 연동은 후속.
 */
@RestController
class IntegrationController(
    @Value("\${ai.url:}") private val aiUrl: String,
) {
    @GetMapping("/api/integration")
    fun integration(): Map<String, Any?> {
        val ai: Any? = if (aiUrl.isBlank()) {
            "not-configured"
        } else {
            runCatching {
                RestClient.create().get().uri("$aiUrl/health").retrieve().body(String::class.java)
            }.getOrElse { "unreachable: ${it.message}" }
        }
        return mapOf("backend" to "UP", "ai" to ai)
    }
}
