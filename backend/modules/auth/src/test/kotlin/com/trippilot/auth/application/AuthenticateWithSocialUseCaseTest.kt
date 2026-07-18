package com.trippilot.auth.application

import com.trippilot.auth.domain.Account
import com.trippilot.auth.domain.AccountId
import com.trippilot.auth.domain.AgeMethod
import com.trippilot.auth.domain.Provider
import com.trippilot.auth.domain.SocialIdentity
import com.trippilot.auth.domain.SocialProfile
import com.trippilot.auth.domain.TokenPair
import com.trippilot.auth.domain.port.AccountRepository
import com.trippilot.auth.domain.port.SocialAuthPort
import com.trippilot.auth.domain.port.SocialIdentityRepository
import com.trippilot.auth.domain.port.TokenIssuer
import com.trippilot.core.event.DomainEvent
import com.trippilot.core.event.DomainEventPublisher
import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.collections.shouldBeEmpty
import io.kotest.matchers.collections.shouldHaveSize
import io.kotest.matchers.shouldBe
import java.time.Clock
import java.time.Instant
import java.time.ZoneOffset

private class FakeAccountRepository : AccountRepository {
    val stored = mutableMapOf<AccountId, Account>()
    override fun findById(id: AccountId) = stored[id]
    override fun save(account: Account) = account.also { stored[it.id] = it }
}

private class FakeSocialIdentityRepository : SocialIdentityRepository {
    val stored = mutableListOf<SocialIdentity>()
    override fun findByProviderAndProviderSub(provider: Provider, providerSub: String) =
        stored.firstOrNull { it.provider == provider && it.providerSub == providerSub }
    override fun save(identity: SocialIdentity) = identity.also { stored.add(it) }
}

private class FakeSocialAuthPort(private val profile: SocialProfile) : SocialAuthPort {
    override fun exchange(provider: Provider, authorizationCode: String, codeVerifier: String, redirectUri: String) = profile
}

private class FakeTokenIssuer : TokenIssuer {
    override fun issue(accountId: AccountId) = TokenPair("access-${accountId.value}", "refresh-${accountId.value}")
}

private class CapturingEventPublisher : DomainEventPublisher {
    val events = mutableListOf<DomainEvent>()
    override fun publish(event: DomainEvent) { events.add(event) }
}

class AuthenticateWithSocialUseCaseTest : StringSpec({

    val clock = Clock.fixed(Instant.parse("2026-01-01T00:00:00Z"), ZoneOffset.UTC)
    val profile = SocialProfile(Provider.KAKAO, "kakao-sub-1", "user@example.com")
    val command = SocialLoginCommand(Provider.KAKAO, "auth-code", "verifier", "trippilot://auth", AgeMethod.SELF_DECLARED, null)

    fun fixture(): Triple<AuthenticateWithSocialUseCase, FakeSocialIdentityRepository, CapturingEventPublisher> {
        val accounts = FakeAccountRepository()
        val identities = FakeSocialIdentityRepository()
        val events = CapturingEventPublisher()
        val useCase = AuthenticateWithSocialUseCase(
            FakeSocialAuthPort(profile), accounts, identities, FakeTokenIssuer(), events, clock,
        )
        return Triple(useCase, identities, events)
    }

    "신규 사용자는 계정+연결을 생성하고 isNewUser=true, AccountCreated 를 발행한다" {
        val (useCase, identities, events) = fixture()

        val result = useCase.authenticate(command)

        result.isNewUser shouldBe true
        identities.stored shouldHaveSize 1
        events.events.map { it.eventType } shouldBe listOf("auth.AccountCreated")
    }

    "기존 사용자는 계정 생성 없이 isNewUser=false, 이벤트를 발행하지 않는다" {
        val (useCase, identities, events) = fixture()
        useCase.authenticate(command) // 최초 가입
        events.events.clear()

        val result = useCase.authenticate(command) // 동일 소셜로 재로그인

        result.isNewUser shouldBe false
        identities.stored shouldHaveSize 1 // 추가 연결 없음
        events.events.shouldBeEmpty()
    }
})
