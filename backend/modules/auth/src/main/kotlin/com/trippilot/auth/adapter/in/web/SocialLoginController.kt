package com.trippilot.auth.adapter.`in`.web

import com.trippilot.auth.application.AuthenticateWithSocialUseCase
import com.trippilot.auth.domain.Provider
import com.trippilot.core.error.FieldError
import com.trippilot.core.error.ValidationFailed
import jakarta.validation.Valid
import org.springframework.web.bind.annotation.PathVariable
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RestController

/**
 * 소셜 로그인/가입 — `POST /api/v1/auth/social/{provider}` → TokenPair(+isNewUser).
 * 서버측 code 교환(시크릿 비노출). 예외는 GlobalExceptionHandler(148)가 에러봉투로 변환.
 */
@RestController
@RequestMapping("/api/v1/auth/social")
class SocialLoginController(
    private val authenticate: AuthenticateWithSocialUseCase,
) {
    @PostMapping("/{provider}")
    fun login(
        @PathVariable provider: String,
        @Valid @RequestBody request: SocialLoginRequest,
    ): SocialLoginResponse {
        val result = authenticate.authenticate(request.toCommand(parseProvider(provider)))
        return SocialLoginResponse(
            accessToken = result.tokens.accessToken,
            refreshToken = result.tokens.refreshToken,
            isNewUser = result.isNewUser,
        )
    }

    private fun parseProvider(raw: String): Provider =
        runCatching { Provider.valueOf(raw.uppercase()) }
            .getOrElse { throw ValidationFailed(listOf(FieldError("provider", "지원하지 않는 제공자: $raw"))) }
}
