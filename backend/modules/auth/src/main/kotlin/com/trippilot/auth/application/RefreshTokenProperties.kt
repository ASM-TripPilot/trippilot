package com.trippilot.auth.application

import org.springframework.boot.context.properties.ConfigurationProperties
import java.time.Duration

/**
 * 리프레시 토큰 설정.
 * @property ttl 리프레시 세션 수명(기본 90일, 설계 §3).
 */
@ConfigurationProperties(prefix = "trippilot.auth.refresh")
data class RefreshTokenProperties(
    val ttl: Duration = Duration.ofDays(90),
)
