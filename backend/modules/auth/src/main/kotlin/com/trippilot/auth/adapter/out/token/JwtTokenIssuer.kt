package com.trippilot.auth.adapter.out.token

import com.trippilot.auth.domain.AccountId
import com.trippilot.auth.domain.port.TokenIssuer
import com.trippilot.security.AccessTokenIssuer
import org.springframework.stereotype.Component

/**
 * TokenIssuer 구현 — common/security 의 AccessTokenIssuer 로 RS256 JWT 액세스 토큰을 발급한다.
 * 리프레시 토큰은 RefreshTokenService(회전·탈취감지)가 별도로 소유한다.
 */
@Component
class JwtTokenIssuer(
    private val accessTokenIssuer: AccessTokenIssuer,
) : TokenIssuer {
    override fun issue(accountId: AccountId): String =
        accessTokenIssuer.issue(accountId.value.toString()).value
}
