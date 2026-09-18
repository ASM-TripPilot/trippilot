package com.trippilot.auth.domain.port

import com.trippilot.auth.domain.AccountId
import java.time.Instant

/**
 * 발급된 액세스 토큰 — 값 + 만료 시각.
 *
 * 만료를 **함께** 돌려주는 이유: 응답의 `expiresIn` 은 발급 시점에만 알 수 있다. 전에는 포트가
 * 문자열만 돌려줘서 만료가 발급자 안에서 버려졌고, 계약에 선언된 `expiresIn` 이 응답에 아예 없었다.
 * 클라이언트는 만료를 모르면 401 을 받고 나서야 갱신하게 된다(TRIP-249).
 */
data class IssuedAccessToken(
    val value: String,
    val expiresAt: Instant,
)

/**
 * 액세스 토큰(RS256 JWT) 발급 포트. 구현은 common/security 에 위임(adapter/out/token).
 * 리프레시 토큰·세션 회전·탈취감지는 RefreshTokenService 가 소유한다(TRIP-153 2단계).
 */
interface TokenIssuer {
    /** 계정에 대한 서명된 액세스 토큰을 발급한다. */
    fun issue(accountId: AccountId): IssuedAccessToken
}
