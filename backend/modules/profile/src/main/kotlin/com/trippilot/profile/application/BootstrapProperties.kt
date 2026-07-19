package com.trippilot.profile.application

import org.springframework.boot.context.properties.ConfigurationProperties

/**
 * 앱 최소/권장 버전(부트스트랩 게이트). DB 아닌 설정값 — 배포 시 주입.
 * 클라이언트 < 최소 → FORCED, < 권장 → RECOMMENDED.
 * 기본값은 min==recommended(1.0.0) — RECOMMENDED 를 쓰려면 배포 시 recommendedVersion 을 min 보다 높게 설정할 것.
 */
@ConfigurationProperties(prefix = "trippilot.bootstrap")
data class BootstrapProperties(
    val minSupportedVersion: String = "1.0.0",
    val recommendedVersion: String = "1.0.0",
)
