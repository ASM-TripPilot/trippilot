package com.trippilot.auth.domain.consent

import com.trippilot.auth.domain.AccountId
import java.time.Instant

/**
 * 마케팅 수신 동의 현재값(V1.2 marketing_consent, 계정당 1행).
 * opt_in 변경은 반드시 [ConsentRecord] 추가와 **동일 트랜잭션**(INV-M1) — 서비스가 규율.
 */
class MarketingConsent private constructor(
    val accountId: AccountId,
    val optIn: Boolean,
    val updatedAt: Instant,
) {
    fun changeTo(optIn: Boolean, now: Instant): MarketingConsent = MarketingConsent(accountId, optIn, now)

    companion object {
        fun of(accountId: AccountId, optIn: Boolean, updatedAt: Instant): MarketingConsent =
            MarketingConsent(accountId, optIn, updatedAt)
    }
}
