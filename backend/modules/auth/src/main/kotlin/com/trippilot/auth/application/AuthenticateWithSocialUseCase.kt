package com.trippilot.auth.application

import com.trippilot.auth.api.event.AccountCreated
import com.trippilot.auth.domain.Account
import com.trippilot.auth.domain.AgeMethod
import com.trippilot.auth.domain.SocialIdentity
import com.trippilot.auth.domain.port.AccountRepository
import com.trippilot.auth.domain.port.SocialAuthPort
import com.trippilot.auth.domain.port.SocialIdentityRepository
import com.trippilot.auth.domain.port.TokenIssuer
import com.trippilot.core.error.AuthenticationRequired
import com.trippilot.core.error.FieldError
import com.trippilot.core.error.ValidationFailed
import com.trippilot.core.event.DomainEventPublisher
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import java.time.Clock

/**
 * 소셜 로그인/가입 유스케이스 — code 교환 → account/social_identity upsert → 토큰 발급.
 * 신규 `(provider, sub)`=가입(즉시 ACTIVE + AccountCreated 발행), 기존=로그인.
 * @Transactional: 신규 분기의 계정·연결 저장 + 이벤트 발행을 원자적으로.
 */
@Service
class AuthenticateWithSocialUseCase(
    private val socialAuthPort: SocialAuthPort,
    private val accountRepository: AccountRepository,
    private val socialIdentityRepository: SocialIdentityRepository,
    private val tokenIssuer: TokenIssuer,
    private val refreshTokenService: RefreshTokenService,
    private val eventPublisher: DomainEventPublisher,
    private val clock: Clock,
) {
    @Transactional
    fun authenticate(command: SocialLoginCommand): SocialLoginResult {
        val profile = socialAuthPort.exchange(
            provider = command.provider,
            authorizationCode = command.authorizationCode,
            codeVerifier = command.codeVerifier,
            redirectUri = command.redirectUri,
        )

        val existing = socialIdentityRepository.findByProviderAndProviderSub(profile.provider, profile.providerSub)

        val account: Account
        val isNewUser: Boolean
        if (existing != null) {
            account = accountRepository.findById(existing.accountId)
                ?: error("social_identity(${existing.provider}/${existing.providerSub})에 대응하는 계정이 없다")
            // 파기·전면정지 계정은 로그인 차단(사유 비노출, SECURITY-15)
            if (!account.canAuthenticate()) throw AuthenticationRequired()
            isNewUser = false
        } else {
            val ageMethod = command.ageMethod
                ?: throw ValidationFailed(listOf(FieldError("ageConfirmation", "신규 가입 시 연령확인이 필요합니다")))
            // BIRTH_DATE 는 생년월일 필수(INV-A2) — 클라 입력 오류이므로 400(도메인 require 로 500 나기 전에 차단)
            if (ageMethod == AgeMethod.BIRTH_DATE && command.birthDate == null) {
                throw ValidationFailed(listOf(FieldError("ageConfirmation.birthDate", "생년월일 연령확인은 생년월일이 필요합니다")))
            }
            val now = clock.instant()
            account = accountRepository.save(
                Account.registerViaSocial(
                    email = profile.email,
                    ageMethod = ageMethod,
                    birthDate = command.birthDate,
                    now = now,
                ),
            )
            socialIdentityRepository.save(SocialIdentity.link(account.id, profile, now))
            eventPublisher.publish(AccountCreated(account.id.value.toString()))
            isNewUser = true
        }

        val refresh = refreshTokenService.issueFor(account.id, command.deviceId)
        return SocialLoginResult(
            accessToken = tokenIssuer.issue(account.id),
            refreshToken = refresh.rawToken,
            isNewUser = isNewUser,
        )
    }
}
