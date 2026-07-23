package com.trippilot.profile.adapter.`in`.web

import com.trippilot.core.error.AuthenticationRequired
import java.security.Principal
import java.util.UUID

/**
 * 인증 주체 → accountId(UUID). 리소스 서버가 JWT 검증 후 인증 이름(=sub=accountId)을 [Principal] 로 주입.
 * spring-security 컴파일 의존 없이 JDK 표준 타입으로 받는다. sub 가 UUID 가 아니면 401.
 */
fun Principal.accountId(): UUID =
    runCatching { UUID.fromString(name) }.getOrElse { throw AuthenticationRequired() }

/**
 * 선택적 인증(부트스트랩) — 토큰 없음/익명(anonymousUser)이면 null, 유효 계정이면 UUID.
 * 비인증 접근을 허용하는 엔드포인트에서 GUEST 구분에 사용.
 */
fun Principal?.accountIdOrNull(): UUID? =
    this?.let { runCatching { UUID.fromString(it.name) }.getOrNull() }
