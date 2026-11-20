package com.trippilot.auth.application

import com.trippilot.auth.domain.Account
import com.trippilot.auth.domain.AccountId
import com.trippilot.auth.domain.port.AccountRepository
import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.collections.shouldContainExactly
import io.kotest.matchers.shouldBe
import java.time.Clock
import java.time.Duration
import java.time.Instant
import java.time.ZoneOffset
import java.util.UUID

/**
 * 계정 파기 스위프(BR-U0-25) — 한 회차가 밀린 대상을 끝까지 비우는가. 실 삭제·CASCADE·경합은 AccountPurgeIT 가 본다.
 * 유예가 밀린 날(배치가 없던 기간에 쌓인 것)은 100건을 넘을 수 있다 — 한 묶음만 지우고 멈추면 나머지가 한 시간씩 더 밀린다.
 */
class AccountPurgeSweeperTest : StringSpec({

    val clock = Clock.fixed(Instant.parse("2026-11-20T00:00:00Z"), ZoneOffset.UTC)

    class Accounts(private var remaining: Int) : AccountRepository {
        val calls = mutableListOf<Triple<Instant, Duration, Int>>()
        override fun findById(id: AccountId): Account? = null
        override fun save(account: Account): Account = account
        override fun findActiveByEmail(email: String): Account? = null
        override fun purgeDue(now: Instant, revocationGrace: Duration, limit: Int): List<AccountId> {
            calls += Triple(now, revocationGrace, limit)
            val n = minOf(limit, remaining)
            remaining -= n
            return List(n) { AccountId(UUID.randomUUID()) }
        }
    }

    "한 묶음이 가득 차면 빌 때까지 이어서 지운다" {
        val accounts = Accounts(remaining = 230)
        AccountPurgeSweeper(accounts, clock).sweep()
        accounts.calls.size shouldBe 3 // 100 + 100 + 30
        accounts.calls.map { it.third }.toSet() shouldContainExactly setOf(100)
    }

    "묶음이 정확히 limit 의 배수면 빈 묶음을 한 번 더 보고 멈춘다" {
        val accounts = Accounts(remaining = 100)
        AccountPurgeSweeper(accounts, clock).sweep()
        accounts.calls.size shouldBe 2
    }

    "대상이 없으면 한 번만 묻는다 — 지금 시각과 revoke 유예 7일로" {
        val accounts = Accounts(remaining = 0)
        AccountPurgeSweeper(accounts, clock).sweep()
        accounts.calls shouldContainExactly listOf(Triple(clock.instant(), Duration.ofDays(7), 100))
    }
})
