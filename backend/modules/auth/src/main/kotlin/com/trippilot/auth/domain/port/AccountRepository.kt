package com.trippilot.auth.domain.port

import com.trippilot.auth.domain.Account
import com.trippilot.auth.domain.AccountId
import java.time.Duration
import java.time.Instant

/** 계정 영속 포트(구현: adapter/out/persistence). */
interface AccountRepository {
    fun findById(id: AccountId): Account?

    fun save(account: Account): Account

    /** 활성 계정 중 이메일(대소문자 무시) 일치 1건 — 소셜 이메일 충돌 판정(INV-A3). 없으면 null. */
    fun findActiveByEmail(email: String): Account?

    /**
     * 30일 유예가 지난 삭제 예약 계정을 파기한다(BR-U0-25) — account 행을 지우고, 연관 데이터는 DB 의 ON DELETE CASCADE 가 지운다.
     * 법정 보존(consent_record · location_legal_log)은 FK 가 없어 남는다. 파기한 계정 id 를 돌려준다(최대 [limit]건).
     *
     * 소셜 제공자 토큰 revoke 가 남은 계정은 [revocationGrace] 동안 미룬다 — social_identity 가 지워지면 revoke 기회가 사라진다.
     */
    fun purgeDue(now: Instant, revocationGrace: Duration, limit: Int): List<AccountId>
}
