package com.trippilot.auth.application

import com.trippilot.auth.api.event.AccountCreated
import com.trippilot.auth.domain.Account
import com.trippilot.auth.domain.SocialIdentity
import com.trippilot.auth.domain.port.AccountRepository
import com.trippilot.auth.domain.port.SocialAuthPort
import com.trippilot.auth.domain.port.SocialIdentityRepository
import com.trippilot.auth.domain.port.TokenIssuer
import com.trippilot.core.event.DomainEventPublisher
import java.time.Clock

/**
 * 소셜 로그인/가입 유스케이스 — code 교환 → account/social_identity upsert → 토큰 발급.
 * 신규 `(provider, sub)`=가입(즉시 ACTIVE + AccountCreated 발행), 기존=로그인.
 *
 * 배선 노트: 포트 구현(어댑터)이 준비되는 배선 단계에서 `@Service` + `@Transactional`(신규 분기의
 * 계정·연결 저장 + 이벤트 발행 원자성) 을 부여한다. 지금은 순수 클래스로 Fake 단위테스트만.
 */
class AuthenticateWithSocialUseCase(
    private val socialAuthPort: SocialAuthPort,
    private val accountRepository: AccountRepository,
    private val socialIdentityRepository: SocialIdentityRepository,
    private val tokenIssuer: TokenIssuer,
    private val eventPublisher: DomainEventPublisher,
    private val clock: Clock,
) {
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
            isNewUser = false
        } else {
            val now = clock.instant()
            account = accountRepository.save(
                Account.registerViaSocial(
                    email = profile.email,
                    ageMethod = command.ageMethod,
                    birthDate = command.birthDate,
                    now = now,
                ),
            )
            socialIdentityRepository.save(SocialIdentity.link(account.id, profile, now))
            eventPublisher.publish(AccountCreated(account.id.value.toString()))
            isNewUser = true
        }

        return SocialLoginResult(tokens = tokenIssuer.issue(account.id), isNewUser = isNewUser)
    }
}
