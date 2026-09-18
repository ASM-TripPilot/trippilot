package com.trippilot.profile.application

import com.trippilot.core.error.ConflictDetected
import com.trippilot.core.error.ErrorCode
import com.trippilot.core.error.ValidationFailed
import com.trippilot.moderation.api.ModerationVerdict
import com.trippilot.moderation.api.TextModerationFacade
import com.trippilot.profile.domain.NicknameCheckReason
import com.trippilot.profile.domain.Profile
import com.trippilot.profile.domain.ProfileRepository
import io.kotest.assertions.throwables.shouldThrow
import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.collections.shouldHaveSize
import io.kotest.matchers.shouldBe
import java.time.Clock
import java.time.Instant
import java.time.ZoneOffset
import java.util.UUID

/** 금칙어 마커 "금칙" 포함 시 위반으로 보는 가짜 퍼사드. */
private class FakeModeration : TextModerationFacade {
    override fun inspect(text: String) =
        if (text.contains("금칙")) ModerationVerdict(false, "PROFANITY") else ModerationVerdict(true, null)
}

private class FakeProfileRepo : ProfileRepository {
    val stored = mutableMapOf<UUID, Profile>()
    val taken = mutableSetOf<String>()
    override fun find(accountId: UUID) = stored[accountId]
    override fun existsByNickname(nickname: String) = taken.any { it.equals(nickname, ignoreCase = true) }
    override fun save(profile: Profile) = profile.also { stored[it.accountId] = it; taken.add(it.nickname) }
}

class NicknameServiceTest : StringSpec({

    val clock = Clock.fixed(Instant.parse("2026-07-19T00:00:00Z"), ZoneOffset.UTC)
    val account = UUID.randomUUID()

    fun service(repo: FakeProfileRepo = FakeProfileRepo()) = NicknameService(FakeModeration(), repo, clock) to repo

    "check — 길이→금칙어→유일 순서로 사유 반환" {
        val (svc, repo) = service()
        repo.taken.add("이미있음")

        svc.check("가").reason shouldBe NicknameCheckReason.TOO_SHORT
        svc.check("금칙포함닉").reason shouldBe NicknameCheckReason.BANNED_WORD
        svc.check("이미있음").reason shouldBe NicknameCheckReason.TAKEN
        svc.check("깨끗한닉").let {
            it.available shouldBe true
            it.reason shouldBe NicknameCheckReason.OK
        }
    }

    "suggestions — 3개 모두 유효(금칙어·중복 없음)" {
        val (svc, _) = service()
        val suggestions = svc.suggestions()
        suggestions shouldHaveSize 3
        suggestions.toSet() shouldHaveSize 3 // 서로 다름
        suggestions.all { svc.check(it).available } shouldBe true
    }

    "setNickname — 프로필 미존재면 생성" {
        val (svc, repo) = service()
        val profile = svc.setNickname(account, "새로운닉")
        profile.nickname shouldBe "새로운닉"
        profile.onboardingCompleted shouldBe false
        repo.find(account)!!.nickname shouldBe "새로운닉"
    }

    "setNickname — 기존 프로필은 닉네임만 변경, 온보딩 완료 보존" {
        val (svc, repo) = service()
        repo.save(Profile.reconstitute(account, "옛닉", Instant.EPOCH, onboardingCompletedAt = Instant.EPOCH))

        val updated = svc.setNickname(account, "바뀐닉")
        updated.nickname shouldBe "바뀐닉"
        updated.onboardingCompleted shouldBe true // 보존
    }

    "setNickname — 중복은 409 NICKNAME_TAKEN" {
        val (svc, repo) = service()
        repo.taken.add("중복닉")
        val ex = shouldThrow<ConflictDetected> { svc.setNickname(account, "중복닉") }
        ex.errorCode shouldBe ErrorCode.NICKNAME_TAKEN
    }

    "setNickname — 금칙어는 ValidationFailed(범주·원문 비노출)" {
        val (svc, _) = service()
        shouldThrow<ValidationFailed> { svc.setNickname(account, "금칙닉네임") }
    }

    "setNickname — 길이 위반은 ValidationFailed" {
        val (svc, _) = service()
        shouldThrow<ValidationFailed> { svc.setNickname(account, "가") }
    }
})
