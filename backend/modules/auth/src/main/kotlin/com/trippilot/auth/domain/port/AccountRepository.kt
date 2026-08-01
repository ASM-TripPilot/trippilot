package com.trippilot.auth.domain.port

import com.trippilot.auth.domain.Account
import com.trippilot.auth.domain.AccountId

/** 계정 영속 포트(구현: adapter/out/persistence). */
interface AccountRepository {
    fun findById(id: AccountId): Account?

    fun save(account: Account): Account

    /** 활성 계정 중 이메일(대소문자 무시) 일치 1건 — 소셜 이메일 충돌 판정(INV-A3). 없으면 null. */
    fun findActiveByEmail(email: String): Account?
}
