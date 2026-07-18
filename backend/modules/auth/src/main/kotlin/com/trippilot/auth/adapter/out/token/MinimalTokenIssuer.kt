package com.trippilot.auth.adapter.out.token

import com.trippilot.auth.domain.AccountId
import com.trippilot.auth.domain.TokenPair
import com.trippilot.auth.domain.port.TokenIssuer
import org.springframework.stereotype.Component
import java.util.UUID

/**
 * TokenIssuer 최소 구현 — 불투명 랜덤 토큰.
 * TODO(TRIP-153): RS256 JWT 액세스 토큰 + RefreshSession 회전·탈취감지로 교체.
 */
@Component
class MinimalTokenIssuer : TokenIssuer {
    override fun issue(accountId: AccountId): TokenPair = TokenPair(
        accessToken = UUID.randomUUID().toString(),
        refreshToken = UUID.randomUUID().toString(),
    )
}
