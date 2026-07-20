package com.trippilot.auth.application

import com.trippilot.auth.domain.port.TokenIssuer
import org.springframework.stereotype.Service

/** 토큰 갱신 결과 — 새 액세스 토큰 + 회전된 새 리프레시 토큰. */
data class RefreshResult(
    val accessToken: String,
    val refreshToken: String,
)

/**
 * 리프레시 토큰으로 액세스 토큰 갱신 — 리프레시를 회전(재사용 탐지 포함)하고 새 액세스 JWT 를 발급한다.
 * 회전 실패(미존재·만료·재사용)는 RefreshTokenService 가 401 로 표면화한다.
 */
@Service
class RefreshAccessTokenUseCase(
    private val refreshTokenService: RefreshTokenService,
    private val tokenIssuer: TokenIssuer,
) {
    fun refresh(rawRefreshToken: String): RefreshResult {
        val rotated = refreshTokenService.rotate(rawRefreshToken)
        return RefreshResult(
            accessToken = tokenIssuer.issue(rotated.accountId),
            refreshToken = rotated.rawToken,
        )
    }
}
