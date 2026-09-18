package com.trippilot.auth.application

import com.trippilot.auth.domain.port.TokenIssuer
import org.springframework.stereotype.Service
import java.time.Clock
import java.time.Duration

/** 토큰 갱신 결과 — 새 액세스 토큰 + 회전된 새 리프레시 토큰 + 각 만료(초). */
data class RefreshResult(
    val accessToken: String,
    val expiresIn: Long,
    val refreshToken: String,
    val refreshExpiresIn: Long,
)

/**
 * 리프레시 토큰으로 액세스 토큰 갱신 — 리프레시를 회전(재사용 탐지 포함)하고 새 액세스 JWT 를 발급한다.
 * 회전 실패(미존재·만료·재사용)는 RefreshTokenService 가 401 로 표면화한다.
 */
@Service
class RefreshAccessTokenUseCase(
    private val refreshTokenService: RefreshTokenService,
    private val tokenIssuer: TokenIssuer,
    private val clock: Clock,
) {
    fun refresh(rawRefreshToken: String): RefreshResult {
        // 발급 직전 시각 기준으로 만료(초)를 잰다 — 사유는 AuthenticateWithSocialUseCase 와 같다.
        val beforeIssue = clock.instant()
        val rotated = refreshTokenService.rotate(rawRefreshToken)
        val access = tokenIssuer.issue(rotated.accountId)
        return RefreshResult(
            accessToken = access.value,
            expiresIn = Duration.between(beforeIssue, access.expiresAt).seconds,
            refreshToken = rotated.rawToken,
            refreshExpiresIn = Duration.between(beforeIssue, rotated.expiresAt).seconds,
        )
    }
}
