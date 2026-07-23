package com.trippilot.security

import org.springframework.boot.context.properties.ConfigurationProperties
import java.time.Duration

/**
 * 액세스 토큰(RS256) 발급·검증 설정. 기본값은 dev/test 용 — prod 는 application.yml 로 고정.
 *
 * @property issuer   토큰 iss 클레임 · 검증 대상.
 * @property audience 토큰 aud 클레임 · 검증 대상(앱 클라이언트).
 * @property accessTokenTtl 액세스 토큰 수명(기본 1h, 설계 §3).
 */
@ConfigurationProperties(prefix = "trippilot.jwt")
data class JwtProperties(
    val issuer: String = "trippilot",
    val audience: String = "trippilot-app",
    val accessTokenTtl: Duration = Duration.ofHours(1),
)
