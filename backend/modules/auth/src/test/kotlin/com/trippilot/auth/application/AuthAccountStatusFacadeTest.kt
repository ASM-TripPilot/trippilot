package com.trippilot.auth.application

import com.trippilot.auth.domain.Account
import com.trippilot.auth.domain.AccountId
import com.trippilot.auth.domain.AgeMethod
import com.trippilot.auth.domain.port.AccountRepository
import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.shouldBe
import java.time.Instant
import java.util.UUID

/**
 * 삭제 유예 상태 조회 — 알림(U6)이 "지금도 삭제 대기 중인가"를 처리 시점에 묻는다. 이벤트 순서에 안 흔들리려면 **상태 그대로**를 말해야 한다:
 * 요청 → 유예 true, 철회 → 다시 false, 파기 완료·없는 계정 → false.
 */
class AuthAccountStatusFacadeTest : StringSpec({

    val now = Instant.parse("2026-11-04T00:00:00Z")

    class Accounts : AccountRepository {
        val stored = mutableMapOf<AccountId, Account>()
        override fun findById(id: AccountId) = stored[id]
        override fun save(account: Account) = account.also { stored[it.id] = it }
        override fun findActiveByEmail(email: String): Account? = null
    }

    "삭제를 요청하면 true, 철회하면 다시 false 다" {
        val accounts = Accounts()
        val facade = AuthAccountStatusFacade(accounts)
        val active = accounts.save(Account.registerViaSocial(null, AgeMethod.SELF_DECLARED, null, now))
        val id = active.id.value

        facade.isDeletionPending(id) shouldBe false

        accounts.save(active.requestDeletion())
        facade.isDeletionPending(id) shouldBe true

        accounts.save(accounts.stored.getValue(active.id).cancelDeletion())
        facade.isDeletionPending(id) shouldBe false
    }

    "파기가 끝난 계정과 없는 계정은 false 다 — 알림이 건드릴 것이 없다" {
        val accounts = Accounts()
        val facade = AuthAccountStatusFacade(accounts)
        val purged = accounts.save(Account.registerViaSocial(null, AgeMethod.SELF_DECLARED, null, now).requestDeletion().completeDeletion(now))

        facade.isDeletionPending(purged.id.value) shouldBe false
        facade.isDeletionPending(UUID.randomUUID()) shouldBe false
    }
})
