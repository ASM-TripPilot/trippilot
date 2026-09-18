package com.trippilot.app.web

import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.RestController

/**
 * 걷는 뼈대(walking skeleton) 헬스 엔드포인트.
 * 운영 헬스는 actuator(/actuator/health)가 담당하며, 이 엔드포인트는 웹 계층 조립 확인용이다.
 */
@RestController
class HealthController {

    @GetMapping("/api/health")
    fun health(): Map<String, String> = mapOf(
        "status" to "UP",
        "service" to "trippilot-backend",
    )
}
