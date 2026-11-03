package com.trippilot.auth.application

import com.trippilot.auth.api.AccountStatusFacade
import com.trippilot.auth.domain.AccountId
import com.trippilot.auth.domain.AccountStatus
import com.trippilot.auth.domain.port.AccountRepository
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import java.util.UUID

/** [AccountStatusFacade] 구현 — 계정 한 건의 상태만 읽는다(쓰기 없음). */
@Service
class AuthAccountStatusFacade(private val accounts: AccountRepository) : AccountStatusFacade {

    @Transactional(readOnly = true)
    override fun isDeletionPending(accountId: UUID): Boolean =
        accounts.findById(AccountId(accountId))?.status == AccountStatus.DELETION_PENDING
}
