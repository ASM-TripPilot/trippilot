package com.trippilot.auth.domain.port

import com.trippilot.auth.domain.AccountId
import com.trippilot.auth.domain.DeletionSchedule

/** 삭제 유예 예약 포트. 활성(미철회) 예약은 계정당 최대 1개(INV-D1). */
interface DeletionScheduleRepository {
    fun findActive(accountId: AccountId): DeletionSchedule?

    fun save(schedule: DeletionSchedule): DeletionSchedule
}
