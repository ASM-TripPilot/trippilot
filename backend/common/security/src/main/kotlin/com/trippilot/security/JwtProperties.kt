package com.trippilot.security

import org.springframework.boot.context.properties.ConfigurationProperties
import java.time.Duration

/**
 * 액세스 토큰(RS256) 발급·검증 설정. 기본값은 dev/test 용 — prod 는 application.yml 로 고정.
 *
 * @property issuer   토큰 iss 클레임 · 검증 대상.
 * @property audience 토큰 aud 클레임 · 검증 대상(앱 클라이언트).
 * @property accessTokenTtl 액세스 토큰 수명(기본 1h, 설계 §3).
 * @property signingKey base64(PKCS#8) RSA 개인키 한 줄. **비면 기동 시 생성**되고, 그 상태는
 *   복제본을 둘 이상 띄우지 못한다(인스턴스마다 다른 키로 서명한다). 공개키는 여기서 파생하므로
 *   따로 주지 않는다 — 짝이 어긋난 조합을 원천적으로 막는다.
 * @property requireConfiguredKey 켜면 [signingKey] 가 빈 채로는 **기동하지 않는다**. 기본은 꺼짐 —
 *   켜 두면 키를 안 넣은 로컬·CI 가 통째로 죽는다. 배포 환경에서 켜는 스위치다(TRIP-850).
 */
@ConfigurationProperties(prefix = "trippilot.jwt")
data class JwtProperties(
    val issuer: String = "trippilot",
    val audience: String = "trippilot-app",
    val accessTokenTtl: Duration = Duration.ofHours(1),
    val signingKey: String = "",
    val requireConfiguredKey: Boolean = false,
)
