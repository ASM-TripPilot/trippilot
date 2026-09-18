package com.trippilot.app.persistence

import com.trippilot.auth.domain.Account
import com.trippilot.auth.domain.AgeMethod
import com.trippilot.auth.domain.CascadeSummary
import com.trippilot.auth.domain.DeletionSchedule
import com.trippilot.auth.domain.port.AccountRepository
import com.trippilot.auth.domain.port.DeletionScheduleRepository
import com.trippilot.testsupport.AbstractPostgresIntegrationTest
import io.kotest.matchers.nulls.shouldBeNull
import io.kotest.matchers.nulls.shouldNotBeNull
import io.kotest.matchers.shouldBe
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.context.SpringBootTest
import java.time.Instant

/**
 * TRIP-158 — 삭제 예약 영속 IT. cascade_summary jsonb 왕복 + 활성/철회 조회(INV-D1).
 */
@SpringBootTest
class DeletionSchedulePersistenceIT : AbstractPostgresIntegrationTest() {

    @Autowired lateinit var accounts: AccountRepository
    @Autowired lateinit var schedules: DeletionScheduleRepository

    private val now = Instant.parse("2026-07-19T00:00:00Z")

    @Test
    fun `삭제 예약 저장·활성 조회 + cascade_summary jsonb 왕복, 철회 후 비활성`() {
        val account = accounts.save(Account.registerViaSocial(null, AgeMethod.SELF_DECLARED, null, now))
        val schedule = DeletionSchedule.create(account.id, now, now.plusSeconds(2_592_000), CascadeSummary.forAccount())
        schedules.save(schedule)

        val found = schedules.findActive(account.id)
        found.shouldNotBeNull()
        found.cascadeSummary.legallyRetained shouldBe listOf("CONSENT_RECORD", "LOCATION_LEGAL_LOG") // jsonb 왕복
        found.purgeAt shouldBe now.plusSeconds(2_592_000)

        schedules.save(schedule.cancel(now.plusSeconds(10)))
        schedules.findActive(account.id).shouldBeNull() // 철회 후 활성 없음(INV-D1)
    }
}
