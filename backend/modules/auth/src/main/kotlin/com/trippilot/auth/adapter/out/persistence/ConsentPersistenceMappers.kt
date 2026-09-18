package com.trippilot.auth.adapter.out.persistence

import com.trippilot.auth.domain.AccountId
import com.trippilot.auth.domain.consent.ConsentAction
import com.trippilot.auth.domain.consent.ConsentChannel
import com.trippilot.auth.domain.consent.ConsentRecord
import com.trippilot.auth.domain.consent.MarketingConsent
import com.trippilot.auth.domain.consent.TermsType
import com.trippilot.auth.domain.consent.TermsVersion

/** consent 영속 ↔ 도메인 매핑. enum 은 name 문자열로 왕복(DB CHECK 제약과 일치). */

fun TermsVersionJpaEntity.toDomain(): TermsVersion =
    TermsVersion(TermsType.valueOf(termsType), version, body, effectiveAt, reconsentRequired)

fun ConsentRecordJpaEntity.toDomain(): ConsentRecord =
    ConsentRecord.of(
        AccountId(accountId),
        TermsType.valueOf(termsType),
        termsVersion,
        ConsentAction.valueOf(action),
        ConsentChannel.valueOf(channel),
        occurredAt,
    )

fun ConsentRecord.toEntity(): ConsentRecordJpaEntity =
    ConsentRecordJpaEntity(accountId.value, termsType.name, termsVersion, action.name, channel.name, occurredAt)

fun MarketingConsentJpaEntity.toDomain(): MarketingConsent =
    MarketingConsent.of(AccountId(accountId), optIn, updatedAt)

fun MarketingConsent.toEntity(): MarketingConsentJpaEntity =
    MarketingConsentJpaEntity(accountId.value, optIn, updatedAt)
