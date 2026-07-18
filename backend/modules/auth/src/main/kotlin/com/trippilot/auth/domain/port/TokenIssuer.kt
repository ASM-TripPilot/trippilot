package com.trippilot.auth.domain.port

import com.trippilot.auth.domain.AccountId
import com.trippilot.auth.domain.TokenPair

/**
 * 토큰 발급 포트. 151 은 최소 구현, 완전한 RS256 JWT + 리프레시 회전·탈취감지는 TRIP-153 이 채운다.
 */
interface TokenIssuer {
    fun issue(accountId: AccountId): TokenPair
}
