package com.trippilot.auth.domain

import io.kotest.matchers.shouldBe
import io.kotest.core.spec.style.StringSpec
import java.time.Duration
import java.time.Instant
import java.util.UUID

/** 리프레시 세션 상태 전이(순수 도메인) — 현행/만료/회전/폐기. */
class RefreshSessionTest : StringSpec({

    val accountId = AccountId(UUID.randomUUID())
    val now = Instant.parse("2026-07-19T00:00:00Z")
    val ttl = Duration.ofDays(90)

    fun issued() = RefreshSession.issue(accountId, "device-1", "hash-0", now, ttl)

    "발급 직후 세션은 현행이다" {
        val s = issued()
        s.isCurrent(now) shouldBe true
        s.isRotated() shouldBe false
        s.isRevoked() shouldBe false
        s.expiresAt shouldBe now.plus(ttl)
    }

    "ttl 경과 후에는 만료·비현행이다" {
        val s = issued()
        val after = now.plus(ttl)
        s.isExpired(after) shouldBe true
        s.isCurrent(after) shouldBe false
    }

    "회전하면 소진 처리되어 현행이 아니다" {
        val s = issued().rotate(now.plusSeconds(60))
        s.isRotated() shouldBe true
        s.isCurrent(now.plusSeconds(60)) shouldBe false
    }

    "폐기하면 현행이 아니다" {
        val s = issued().revoke(now.plusSeconds(60))
        s.isRevoked() shouldBe true
        s.isCurrent(now.plusSeconds(60)) shouldBe false
    }

    "next 는 같은 체인에 새 식별자로 이어진다" {
        val first = issued()
        val next = RefreshSession.next(first, "hash-1", now.plusSeconds(60), ttl)
        next.chainId shouldBe first.chainId
        (next.id == first.id) shouldBe false
        next.isCurrent(now.plusSeconds(60)) shouldBe true
    }
})
