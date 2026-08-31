package com.trippilot.auth.adapter.`in`.web

import com.trippilot.auth.application.RefreshAccessTokenUseCase
import com.trippilot.auth.application.RefreshTokenService
import jakarta.validation.Valid
import jakarta.validation.constraints.NotBlank
import org.springframework.http.HttpStatus
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.ResponseStatus
import org.springframework.web.bind.annotation.RestController

/**
 * 토큰 갱신·로그아웃. 둘 다 리프레시 토큰을 본문으로 받아 자체 검증한다(공개 화이트리스트).
 * 갱신 실패(미존재·만료·재사용)는 401 로 표면화되고 GlobalExceptionHandler 가 에러봉투로 변환한다.
 */
@RestController
@RequestMapping("/api/v1/auth")
class TokenController(
    private val refreshAccessToken: RefreshAccessTokenUseCase,
    private val refreshTokenService: RefreshTokenService,
) {
    @PostMapping("/token/refresh")
    fun refresh(@Valid @RequestBody request: RefreshTokenRequest): RefreshTokenResponse {
        val result = refreshAccessToken.refresh(request.refreshToken)
        return RefreshTokenResponse(
            accessToken = result.accessToken,
            tokenType = BEARER,
            expiresIn = result.expiresIn,
            refreshToken = result.refreshToken,
            refreshExpiresIn = result.refreshExpiresIn,
        )
    }

    /** 로그아웃 — 리프레시 세션 폐기. 멱등(이미 폐기·미존재여도 204). */
    @PostMapping("/logout")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    fun logout(@Valid @RequestBody request: LogoutRequest) {
        refreshTokenService.revoke(request.refreshToken)
    }
}

data class RefreshTokenRequest(
    @field:NotBlank val refreshToken: String,
)

/**
 * 갱신 응답(계약의 RefreshedTokenPair). 소셜 로그인의 TokenPair 와 달리 `isNewUser`·`account` 가 없다 —
 * 갱신에서 "신규 가입"은 언제나 거짓이고, 계정 요약을 실으려면 갱신마다 계정을 한 번 더 조회해야 한다.
 * 계정 상태는 `GET /me` 가 소유한다.
 */
data class RefreshTokenResponse(
    val accessToken: String,
    val tokenType: String,
    val expiresIn: Long,
    val refreshToken: String,
    val refreshExpiresIn: Long,
)

data class LogoutRequest(
    @field:NotBlank val refreshToken: String,
)
