package com.trippilot.auth.adapter.out.token

import com.trippilot.auth.domain.AccountId
import com.trippilot.auth.domain.TokenPair
import com.trippilot.auth.domain.port.TokenIssuer
import com.trippilot.security.AccessTokenIssuer
import org.springframework.stereotype.Component
import java.util.UUID

/**
 * TokenIssuer 구현 — RS256 JWT 액세스 토큰(common/security) + 불투명 리프레시 토큰.
 *
 * 리프레시 토큰의 영속화·회전·탈취감지(RefreshSession)는 TRIP-153 2단계가 채운다.
 * 현재 리프레시는 미저장 랜덤값이라 갱신 엔드포인트가 아직 검증하지 못한다.
 */
@Component
class JwtTokenIssuer(
    private val accessTokenIssuer: AccessTokenIssuer,
) : TokenIssuer {
    override fun issue(accountId: AccountId): TokenPair = TokenPair(
        accessToken = accessTokenIssuer.issue(accountId.value.toString()).value,
        refreshToken = UUID.randomUUID().toString(),
    )
}
