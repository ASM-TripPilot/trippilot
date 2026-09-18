package com.trippilot.auth.application

import com.trippilot.auth.domain.AccountId
import com.trippilot.auth.domain.AccountStatus
import com.trippilot.auth.domain.Provider
import com.trippilot.auth.domain.port.AccountRepository
import com.trippilot.auth.domain.port.SocialIdentityRepository
import com.trippilot.core.error.AuthenticationRequired
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import java.util.UUID

/** 계정 요약(GET /me) — 상태·이메일·연결된 소셜 제공자. */
data class AccountSummary(
    val accountId: UUID,
    val status: AccountStatus,
    val email: String?,
    val socialProviders: List<Provider>,
)

/** 계정 요약 조회. 온보딩 완료 여부는 profile 소관(GET /me/profile) — R1 상 여기서 다루지 않는다. */
@Service
class AccountSummaryService(
    private val accounts: AccountRepository,
    private val socialIdentities: SocialIdentityRepository,
) {
    @Transactional(readOnly = true)
    fun summary(accountId: AccountId): AccountSummary {
        val account = accounts.findById(accountId) ?: throw AuthenticationRequired()
        return AccountSummary(
            accountId = account.id.value,
            status = account.status,
            email = account.email,
            socialProviders = socialIdentities.findByAccountId(accountId).map { it.provider },
        )
    }
}
