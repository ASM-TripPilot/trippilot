package com.trippilot.auth.application

import com.trippilot.auth.FakeRefreshSessionRepository
import com.trippilot.auth.FakeRefreshTokenGenerator
import com.trippilot.auth.domain.AccountId
import com.trippilot.core.error.AuthenticationRequired
import com.trippilot.core.error.ErrorCode
import io.kotest.assertions.throwables.shouldThrow
import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.shouldBe
import io.kotest.matchers.shouldNotBe
import java.time.Clock
import java.time.Duration
import java.time.Instant
import java.time.ZoneOffset
import java.util.UUID

/** 리프레시 회전·재사용 탐지 핵심 로직(인메모리 fake — DB 불필요). */
class RefreshTokenServiceTest : StringSpec({

    val accountId = AccountId(UUID.randomUUID())
    val start = Instant.parse("2026-07-19T00:00:00Z")

    fun serviceAt(instant: Instant, repo: FakeRefreshSessionRepository) =
        RefreshTokenService(repo, FakeRefreshTokenGenerator(), RefreshTokenProperties(), Clock.fixed(instant, ZoneOffset.UTC))

    "issueFor 는 현행 세션을 저장하고 원문 토큰을 반환한다" {
        val repo = FakeRefreshSessionRepository()
        val issued = serviceAt(start, repo).issueFor(accountId, "device-1")

        issued.rawToken shouldBe "raw-0"
        repo.sessions.values.single().isCurrent(start) shouldBe true
    }

    "rotate 는 이전 토큰을 소진하고 같은 체인에 새 토큰을 발급한다" {
        val repo = FakeRefreshSessionRepository()
        val svc = serviceAt(start, repo)
        val first = svc.issueFor(accountId, "device-1")

        val rotated = svc.rotate(first.rawToken)

        rotated.accountId shouldBe accountId
        rotated.rawToken shouldNotBe first.rawToken
        repo.sessions.values.map { it.chainId }.distinct().size shouldBe 1 // 같은 체인
        repo.sessions.values.count { it.isCurrent(start) } shouldBe 1       // 현행은 1개
    }

    "소진된 토큰 재제시는 재사용 → 체인 전체 폐기 + REFRESH_REUSE_DETECTED" {
        val repo = FakeRefreshSessionRepository()
        val svc = serviceAt(start, repo)
        val first = svc.issueFor(accountId, "device-1")
        svc.rotate(first.rawToken) // first 소진

        val ex = shouldThrow<AuthenticationRequired> { svc.rotate(first.rawToken) }

        ex.errorCode shouldBe ErrorCode.REFRESH_REUSE_DETECTED
        repo.sessions.values.all { it.isRevoked() } shouldBe true // 후속 현행 세션까지 폐기
    }

    "미존재 토큰은 REFRESH_TOKEN_INVALID" {
        val ex = shouldThrow<AuthenticationRequired> {
            serviceAt(start, FakeRefreshSessionRepository()).rotate("no-such-token")
        }
        ex.errorCode shouldBe ErrorCode.REFRESH_TOKEN_INVALID
    }

    "만료된 토큰은 REFRESH_TOKEN_INVALID" {
        val repo = FakeRefreshSessionRepository()
        val first = serviceAt(start, repo).issueFor(accountId, "device-1")

        val ex = shouldThrow<AuthenticationRequired> {
            serviceAt(start.plus(Duration.ofDays(91)), repo).rotate(first.rawToken)
        }
        ex.errorCode shouldBe ErrorCode.REFRESH_TOKEN_INVALID
    }

    "revoke 후에는 회전이 무효다(로그아웃)" {
        val repo = FakeRefreshSessionRepository()
        val svc = serviceAt(start, repo)
        val first = svc.issueFor(accountId, "device-1")

        svc.revoke(first.rawToken)

        repo.sessions.values.single().isRevoked() shouldBe true
        shouldThrow<AuthenticationRequired> { svc.rotate(first.rawToken) }
    }
})
