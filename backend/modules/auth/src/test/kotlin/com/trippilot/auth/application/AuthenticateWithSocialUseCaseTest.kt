package com.trippilot.auth.application

import com.trippilot.auth.FakeRefreshSessionRepository
import com.trippilot.auth.FakeRefreshTokenGenerator
import com.trippilot.auth.domain.Account
import com.trippilot.auth.domain.AccountId
import com.trippilot.auth.domain.AccountStatus
import com.trippilot.auth.domain.AgeMethod
import com.trippilot.auth.domain.Provider
import com.trippilot.auth.domain.SanctionStatus
import com.trippilot.auth.domain.SocialIdentity
import com.trippilot.auth.domain.SocialProfile
import com.trippilot.auth.domain.port.AccountRepository
import com.trippilot.auth.domain.port.IssuedAccessToken
import com.trippilot.auth.domain.port.PendingRevocation
import com.trippilot.auth.domain.port.ProviderRevocationTokenRepository
import com.trippilot.auth.domain.port.ProviderTokenRevocationPort
import com.trippilot.auth.domain.port.SocialAuthPort
import com.trippilot.auth.domain.port.SocialIdentityRepository
import com.trippilot.auth.domain.port.TokenIssuer
import com.trippilot.core.error.AuthenticationRequired
import com.trippilot.core.error.ConflictDetected
import com.trippilot.core.error.ErrorCode
import com.trippilot.core.error.ValidationFailed
import com.trippilot.core.event.DomainEvent
import com.trippilot.core.event.DomainEventPublisher
import io.kotest.assertions.throwables.shouldThrow
import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.collections.shouldBeEmpty
import io.kotest.matchers.collections.shouldHaveSize
import io.kotest.matchers.shouldBe
import io.kotest.matchers.string.shouldContain
import java.time.Clock
import java.time.Duration
import java.time.Instant
import java.time.ZoneOffset

private class FakeAccountRepository : AccountRepository {
    val stored = mutableMapOf<AccountId, Account>()
    override fun findById(id: AccountId) = stored[id]
    override fun save(account: Account) = account.also { stored[it.id] = it }
    override fun findActiveByEmail(email: String) =
        stored.values.firstOrNull { it.email?.lowercase() == email.lowercase() }
}

private class FakeSocialIdentityRepository : SocialIdentityRepository {
    val stored = mutableListOf<SocialIdentity>()
    override fun findByProviderAndProviderSub(provider: Provider, providerSub: String) =
        stored.firstOrNull { it.provider == provider && it.providerSub == providerSub }
    override fun findByAccountId(accountId: AccountId) = stored.filter { it.accountId == accountId }
    override fun save(identity: SocialIdentity) = identity.also { stored.add(it) }
}

private class FakeSocialAuthPort(private val profile: SocialProfile) : SocialAuthPort {
    override fun exchange(provider: Provider, authorizationCode: String, codeVerifier: String, redirectUri: String) = profile
    override fun authenticateWithAccessToken(provider: Provider, accessToken: String) = profile
}

/** 교환 결과를 고정으로 돌려주고, 불린 횟수를 센다. */
private class FakeTokenRevocation(private val result: String? = null) : ProviderTokenRevocationPort {
    val exchanges = mutableListOf<Triple<Provider, String, String>>()
    override fun exchangeRevocationToken(provider: Provider, authorizationCode: String, expectedSub: String): String? {
        exchanges += Triple(provider, authorizationCode, expectedSub)
        return result
    }
    override fun revoke(provider: Provider, token: String) = error("로그인에서 revoke 를 부르면 안 된다")
}

private class FakeRevocationTokens : ProviderRevocationTokenRepository {
    val stored = mutableMapOf<Pair<Provider, String>, String>()
    override fun store(provider: Provider, providerSub: String, token: String) { stored[provider to providerSub] = token }
    override fun findDueForRevocation(now: Instant, limit: Int) = emptyList<PendingRevocation>()
    override fun clear(socialIdentityId: java.util.UUID) = Unit
}

private class FakeTokenIssuer(private val clock: Clock) : TokenIssuer {
    override fun issue(accountId: AccountId) =
        IssuedAccessToken(value = "access-${accountId.value}", expiresAt = clock.instant().plus(TTL))

    companion object {
        val TTL: Duration = Duration.ofHours(1)
    }
}

private class CapturingEventPublisher : DomainEventPublisher {
    val events = mutableListOf<DomainEvent>()
    override fun publish(event: DomainEvent) { events.add(event) }
}

class AuthenticateWithSocialUseCaseTest : StringSpec({

    val clock = Clock.fixed(Instant.parse("2026-01-01T00:00:00Z"), ZoneOffset.UTC)
    val profile = SocialProfile(Provider.KAKAO, "kakao-sub-1", "user@example.com")
    val command = SocialLoginCommand(Provider.KAKAO, "auth-code", "verifier", "trippilot://auth", AgeMethod.SELF_DECLARED, null, "device-1")
    val tokenCommand = SocialTokenLoginCommand(Provider.KAKAO, "sdk-access-token", AgeMethod.SELF_DECLARED, null, "device-1")

    fun fixture(): Triple<AuthenticateWithSocialUseCase, FakeSocialIdentityRepository, CapturingEventPublisher> {
        val accounts = FakeAccountRepository()
        val identities = FakeSocialIdentityRepository()
        val events = CapturingEventPublisher()
        val refreshTokenService = RefreshTokenService(
            FakeRefreshSessionRepository(), accounts, FakeRefreshTokenGenerator(), RefreshTokenProperties(), clock,
        )
        val useCase = AuthenticateWithSocialUseCase(
            FakeSocialAuthPort(profile), accounts, identities, FakeTokenIssuer(clock), refreshTokenService, events, clock,
            FakeTokenRevocation(), FakeRevocationTokens(),
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

    "SDK 토큰 로그인도 신규 가입·재로그인이 code 흐름과 동일하게 동작한다" {
        val (useCase, identities, events) = fixture()

        val created = useCase.authenticateWithAccessToken(tokenCommand)
        created.isNewUser shouldBe true
        identities.stored shouldHaveSize 1
        events.events.map { it.eventType } shouldBe listOf("auth.AccountCreated")

        events.events.clear()
        val relogin = useCase.authenticateWithAccessToken(tokenCommand)
        relogin.isNewUser shouldBe false
        identities.stored shouldHaveSize 1
        events.events.shouldBeEmpty()
    }

    // TRIP-249 5번 — 계약(TokenPair)이 선언한 만료·계정 요약이 결과에 실제로 실리는가.
    // 전에는 셋(accessToken·refreshToken·isNewUser)만 채워 나머지가 조용히 빠졌다.
    "신규 로그인 결과는 만료(초)와 계정 요약을 함께 싣는다" {
        val (useCase, _, _) = fixture()

        val result = useCase.authenticate(command)

        // 만료를 모르면 클라는 401 을 받고 나서야 갱신한다 — 0 이나 음수면 그 판단이 아예 불가능하다.
        result.expiresIn shouldBe FakeTokenIssuer.TTL.seconds
        result.refreshExpiresIn shouldBe RefreshTokenProperties().ttl.seconds
        result.account.status shouldBe AccountStatus.ACTIVE
        result.account.email shouldBe "user@example.com"
        // 방금 연결한 제공자다. 비어 있으면 앱이 "무엇으로 로그인했는지"를 못 그린다.
        result.account.socialProviders shouldBe listOf(Provider.KAKAO)
    }

    "재로그인 결과의 계정 요약은 저장된 연결에서 온다" {
        val (useCase, identities, _) = fixture()
        val created = useCase.authenticate(command)

        val relogin = useCase.authenticate(command)

        relogin.account.accountId shouldBe created.account.accountId
        relogin.account.socialProviders shouldBe identities.stored.map { it.provider }
    }

    "이미 다른 소셜로 가입된 이메일이면 409 ConflictDetected — 어느 provider인지 안내" {
        val accounts = FakeAccountRepository()
        val identities = FakeSocialIdentityRepository()
        val refresh = RefreshTokenService(
            FakeRefreshSessionRepository(), accounts, FakeRefreshTokenGenerator(), RefreshTokenProperties(), clock,
        )
        fun ucFor(p: SocialProfile) = AuthenticateWithSocialUseCase(
            FakeSocialAuthPort(p), accounts, identities, FakeTokenIssuer(clock), refresh, CapturingEventPublisher(), clock,
            FakeTokenRevocation(), FakeRevocationTokens(),
        )
        // 카카오로 먼저 가입(email dup@example.com)
        ucFor(SocialProfile(Provider.KAKAO, "kakao-sub", "dup@example.com")).authenticate(command)
        // 네이버(다른 sub)로 같은 이메일 가입 시도 → 충돌, 메시지에 기존 provider(카카오)
        val ex = shouldThrow<ConflictDetected> {
            ucFor(SocialProfile(Provider.NAVER, "naver-sub", "dup@example.com")).authenticate(command)
        }
        ex.errorCode shouldBe ErrorCode.SOCIAL_EMAIL_CONFLICT
        ex.message shouldContain "카카오"
        // TRIP-211 — 안내가 message 문자열에만 있으면 웹 계층이 그것을 파싱해야 한다.
        // current 에 기존 provider 를 담아야 봉투가 계약 필드로 실어 보낼 수 있다(BR-U0-04 · INV-A3).
        ex.current shouldBe listOf("KAKAO")
    }

    "신규 가입인데 BIRTH_DATE 연령확인에 생년월일이 없으면 ValidationFailed(400)" {
        val (useCase, _, _) = fixture()
        val birthDateMissing = command.copy(ageMethod = AgeMethod.BIRTH_DATE, birthDate = null)

        shouldThrow<ValidationFailed> { useCase.authenticate(birthDateMissing) }
    }

    "전면 정지된 기존 계정은 재로그인이 차단된다 (canAuthenticate=false → 401)" {
        val accounts = FakeAccountRepository()
        val useCase = AuthenticateWithSocialUseCase(
            FakeSocialAuthPort(profile), accounts, FakeSocialIdentityRepository(), FakeTokenIssuer(clock),
            RefreshTokenService(FakeRefreshSessionRepository(), accounts, FakeRefreshTokenGenerator(), RefreshTokenProperties(), clock),
            CapturingEventPublisher(), clock, FakeTokenRevocation(), FakeRevocationTokens(),
        )
        useCase.authenticate(command) // 최초 가입 → ACTIVE
        val stored = accounts.stored.values.first()
        accounts.save(stored.applySanction(SanctionStatus.FULLY_SUSPENDED)) // 전면 정지

        shouldThrow<AuthenticationRequired> { useCase.authenticate(command) }
    }

    // ── 애플 revoke 용 토큰(TRIP-933) ─────────────────────────────────────────────

    val appleProfile = SocialProfile(Provider.APPLE, "apple-sub-1", null)
    val appleCommand = SocialTokenLoginCommand(
        Provider.APPLE, "identity-token", AgeMethod.SELF_DECLARED, null, "device-1", authorizationCode = "apple-code",
    )

    fun appleFixture(exchangeResult: String?): Triple<AuthenticateWithSocialUseCase, FakeTokenRevocation, FakeRevocationTokens> {
        val accounts = FakeAccountRepository()
        val revocation = FakeTokenRevocation(exchangeResult)
        val tokens = FakeRevocationTokens()
        val useCase = AuthenticateWithSocialUseCase(
            FakeSocialAuthPort(appleProfile), accounts, FakeSocialIdentityRepository(), FakeTokenIssuer(clock),
            RefreshTokenService(FakeRefreshSessionRepository(), accounts, FakeRefreshTokenGenerator(), RefreshTokenProperties(), clock),
            CapturingEventPublisher(), clock, revocation, tokens,
        )
        return Triple(useCase, revocation, tokens)
    }

    "애플 로그인에 authorizationCode 가 오면 교환해 revoke 토큰을 그 연결에 보관한다" {
        val (useCase, revocation, tokens) = appleFixture(exchangeResult = "apple-refresh")

        useCase.authenticateWithAccessToken(appleCommand)

        // 교환은 로그인한 사람의 sub 로 대조된다 — 남의 code 를 붙여 보내도 우리 연결에 걸리지 않게.
        revocation.exchanges shouldBe listOf(Triple(Provider.APPLE, "apple-code", "apple-sub-1"))
        tokens.stored shouldBe mapOf((Provider.APPLE to "apple-sub-1") to "apple-refresh")
    }

    "교환이 실패해도 로그인은 성공한다 — Apple 토큰 엔드포인트 장애가 애플 로그인 장애가 되지 않는다" {
        val (useCase, _, tokens) = appleFixture(exchangeResult = null)

        val result = useCase.authenticateWithAccessToken(appleCommand)

        result.isNewUser shouldBe true
        result.accessToken shouldContain "access-"
        tokens.stored shouldBe emptyMap()
    }

    "authorizationCode 가 없으면 교환하지 않는다 — 종전 애플·카카오 로그인은 그대로다" {
        val (useCase, revocation, _) = appleFixture(exchangeResult = "apple-refresh")

        useCase.authenticateWithAccessToken(appleCommand.copy(authorizationCode = null))

        revocation.exchanges.shouldBeEmpty()
    }

    "로그인이 무산되면(연령확인 누락 400) 일회용 code 를 태우지 않는다" {
        val (useCase, revocation, _) = appleFixture(exchangeResult = "apple-refresh")

        shouldThrow<ValidationFailed> { useCase.authenticateWithAccessToken(appleCommand.copy(ageMethod = null)) }

        revocation.exchanges.shouldBeEmpty()
    }
})
