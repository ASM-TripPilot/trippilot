package com.trippilot.auth.adapter.out.persistence

import com.trippilot.auth.domain.Account
import com.trippilot.auth.domain.AccountId
import com.trippilot.auth.domain.AccountStatus
import com.trippilot.auth.domain.AgeMethod
import com.trippilot.auth.domain.Provider
import com.trippilot.auth.domain.SanctionStatus
import com.trippilot.auth.domain.RefreshSession
import com.trippilot.auth.domain.RefreshSessionId
import com.trippilot.auth.domain.SocialIdentity
import com.trippilot.auth.domain.SocialIdentityId

fun AccountJpaEntity.toDomain(): Account = Account.reconstitute(
    id = AccountId(accountId),
    email = email,
    ageMethod = AgeMethod.valueOf(ageMethod),
    birthDate = birthDate,
    ageConfirmedAt = ageConfirmedAt,
    status = AccountStatus.valueOf(status),
    createdAt = createdAt,
    verifiedAt = verifiedAt,
    sanctionStatus = SanctionStatus.valueOf(sanctionStatus),
    deletedAt = deletedAt,
)

fun Account.toEntity(): AccountJpaEntity = AccountJpaEntity(
    accountId = id.value,
    email = email,
    ageMethod = ageMethod.name,
    birthDate = birthDate,
    ageConfirmedAt = ageConfirmedAt,
    status = status.name,
    sanctionStatus = sanctionStatus.name,
    createdAt = createdAt,
    verifiedAt = verifiedAt,
    deletedAt = deletedAt,
)

fun SocialIdentityJpaEntity.toDomain(): SocialIdentity = SocialIdentity.reconstitute(
    id = SocialIdentityId(socialIdentityId),
    accountId = AccountId(accountId),
    provider = Provider.valueOf(provider),
    providerSub = providerSub,
    providerEmail = providerEmail,
    linkedAt = linkedAt,
)

fun SocialIdentity.toEntity(): SocialIdentityJpaEntity = SocialIdentityJpaEntity(
    socialIdentityId = id.value,
    accountId = accountId.value,
    provider = provider.name,
    providerSub = providerSub,
    providerEmail = providerEmail,
    linkedAt = linkedAt,
)

fun RefreshSessionJpaEntity.toDomain(): RefreshSession = RefreshSession.reconstitute(
    id = RefreshSessionId(sessionId),
    accountId = AccountId(accountId),
    deviceId = deviceId,
    tokenHash = tokenHash,
    chainId = chainId,
    issuedAt = issuedAt,
    expiresAt = expiresAt,
    rotatedAt = rotatedAt,
    revokedAt = revokedAt,
)

fun RefreshSession.toEntity(): RefreshSessionJpaEntity = RefreshSessionJpaEntity(
    sessionId = id.value,
    accountId = accountId.value,
    deviceId = deviceId,
    tokenHash = tokenHash,
    chainId = chainId,
    issuedAt = issuedAt,
    expiresAt = expiresAt,
    rotatedAt = rotatedAt,
    revokedAt = revokedAt,
)
