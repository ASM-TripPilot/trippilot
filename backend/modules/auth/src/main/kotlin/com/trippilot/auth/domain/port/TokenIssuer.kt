package com.trippilot.auth.domain.port

import com.trippilot.auth.domain.AccountId

/**
 * 액세스 토큰(RS256 JWT) 발급 포트. 구현은 common/security 에 위임(adapter/out/token).
 * 리프레시 토큰·세션 회전·탈취감지는 RefreshTokenService 가 소유한다(TRIP-153 2단계).
 */
interface TokenIssuer {
    /** 계정에 대한 서명된 액세스 토큰 문자열을 발급한다. */
    fun issue(accountId: AccountId): String
}
