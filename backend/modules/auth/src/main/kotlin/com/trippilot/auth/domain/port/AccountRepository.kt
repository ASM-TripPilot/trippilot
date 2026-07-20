package com.trippilot.auth.domain.port

import com.trippilot.auth.domain.Account
import com.trippilot.auth.domain.AccountId

/** 계정 영속 포트(구현: adapter/out/persistence). */
interface AccountRepository {
    fun findById(id: AccountId): Account?

    fun save(account: Account): Account
}
