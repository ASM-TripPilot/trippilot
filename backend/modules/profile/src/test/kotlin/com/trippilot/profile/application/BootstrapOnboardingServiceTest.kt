package com.trippilot.profile.application

import com.trippilot.auth.api.ConsentFacade
import com.trippilot.core.error.ValidationFailed
import com.trippilot.profile.domain.AppUpdateStatus
import com.trippilot.profile.domain.Profile
import com.trippilot.profile.domain.ProfileRepository
import io.kotest.assertions.throwables.shouldThrow
import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.shouldBe
import java.time.Clock
import java.time.Instant
import java.time.ZoneOffset
import java.util.UUID

private class FakeConsentFacade(
    var reconsents: List<String> = emptyList(),
    var hasConsents: Boolean = true,
) : ConsentFacade {
    override fun requiredReconsentTermsTypes(accountId: UUID) = reconsents
    override fun hasCompletedOnboardingConsents(accountId: UUID) = hasConsents
}

private class FakeProfiles : ProfileRepository {
    val stored = mutableMapOf<UUID, Profile>()
    override fun find(accountId: UUID) = stored[accountId]
    override fun existsByNickname(nickname: String) = stored.values.any { it.nickname.equals(nickname, true) }
    override fun save(profile: Profile) = profile.also { stored[it.accountId] = it }
}

class BootstrapOnboardingServiceTest : StringSpec({

    val now = Instant.parse("2026-07-19T00:00:00Z")
    val clock = Clock.fixed(now, ZoneOffset.UTC)
    val account = UUID.randomUUID()
    val props = BootstrapProperties(minSupportedVersion = "1.0.0", recommendedVersion = "1.5.0")

    // --- Bootstrap ---
    "GUEST(비인증) — 재동의·온보딩 없음, 세션 GUEST" {
        val svc = BootstrapService(FakeConsentFacade(), FakeProfiles(), props)
        val r = svc.bootstrap(accountId = null, clientVersion = "1.6.0")
        r.authenticated shouldBe false
        r.reconsentTermsTypes shouldBe emptyList()
        r.onboardingCompleted shouldBe false
        r.appUpdateStatus shouldBe AppUpdateStatus.NONE
    }

    "인증 — 재동의 필요 목록과 온보딩 상태를 집계" {
        val profiles = FakeProfiles()
        profiles.save(Profile.reconstitute(account, "닉", now, onboardingCompletedAt = now))
        val svc = BootstrapService(FakeConsentFacade(reconsents = listOf("PRIVACY_POLICY")), profiles, props)

        val r = svc.bootstrap(account, "0.9.0")

        r.authenticated shouldBe true
        r.reconsentTermsTypes shouldBe listOf("PRIVACY_POLICY")
        r.onboardingCompleted shouldBe true
        r.appUpdateStatus shouldBe AppUpdateStatus.FORCED // 0.9 < 1.0
    }

    "인증인데 프로필 미생성이면 onboardingCompleted=false" {
        val svc = BootstrapService(FakeConsentFacade(), FakeProfiles(), props)
        svc.bootstrap(account, "1.6.0").onboardingCompleted shouldBe false
    }

    // --- Onboarding complete ---
    "온보딩 완료 — 약관+닉네임 충족 시 완료 시각 설정" {
        val profiles = FakeProfiles()
        profiles.save(Profile.create(account, "여행자", now))
        val svc = OnboardingService(FakeConsentFacade(hasConsents = true), profiles, clock)

        svc.complete(account) shouldBe now
        profiles.find(account)!!.onboardingCompleted shouldBe true
    }

    "온보딩 완료는 멱등 — 재호출은 재설정하지 않고 최초 시각을 반환(진행 clock)" {
        // 매 instant() 호출마다 1초 진행 — 재설정(now2)과 저장값 반환(now1)을 구분
        val ticking = object : Clock() {
            private var t = now
            override fun instant(): Instant = t.also { t = t.plusSeconds(1) }
            override fun getZone() = ZoneOffset.UTC
            override fun withZone(zone: java.time.ZoneId) = this
        }
        val profiles = FakeProfiles()
        profiles.save(Profile.create(account, "여행자", now))
        val svc = OnboardingService(FakeConsentFacade(hasConsents = true), profiles, ticking)

        val first = svc.complete(account)
        val second = svc.complete(account)
        second shouldBe first // 재설정됐다면 1초 뒤 시각이라 불일치
    }

    "필수 약관 미충족은 400" {
        val profiles = FakeProfiles()
        profiles.save(Profile.create(account, "여행자", now))
        val svc = OnboardingService(FakeConsentFacade(hasConsents = false), profiles, clock)
        shouldThrow<ValidationFailed> { svc.complete(account) }
    }

    "닉네임(프로필) 미설정은 400" {
        val svc = OnboardingService(FakeConsentFacade(hasConsents = true), FakeProfiles(), clock)
        shouldThrow<ValidationFailed> { svc.complete(account) }
    }
})
