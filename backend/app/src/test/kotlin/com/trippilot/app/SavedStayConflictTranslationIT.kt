package com.trippilot.app

import com.trippilot.auth.domain.Account
import com.trippilot.auth.domain.AgeMethod
import com.trippilot.auth.domain.port.AccountRepository
import com.trippilot.core.error.ConflictDetected
import com.trippilot.core.event.DomainEventPublisher
import com.trippilot.savedaccommodation.application.RegisterStayCommand
import com.trippilot.savedaccommodation.application.SavedStayService
import com.trippilot.savedaccommodation.domain.BaseAssignmentRepository
import com.trippilot.savedaccommodation.domain.RegisterRoute
import com.trippilot.savedaccommodation.domain.SavedStayRepository
import com.trippilot.testsupport.AbstractPostgresIntegrationTest
import io.kotest.assertions.throwables.shouldThrow
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.dao.DataIntegrityViolationException
import java.time.Clock
import java.time.Instant

/**
 * 저장 숙소 등록의 제약 위반 번역은 **유니크 경합만** 409 다(TRIP-1473) — 실 DB 로 본다. 제약 이름은 Hibernate 의
 * PostgreSQL 방언이 오류 문구에서 뽑으므로, 이름 비교가 맞는지는 대역으로는 확인되지 않는다.
 *
 * 선검사(`existsByAccountAndExternal`)를 거짓으로 돌려 경합 순간을 재현한다 — 저장은 실 어댑터(saveAndFlush)다.
 */
@SpringBootTest
class SavedStayConflictTranslationIT : AbstractPostgresIntegrationTest() {

    @Autowired private lateinit var accounts: AccountRepository
    @Autowired private lateinit var stays: SavedStayRepository
    @Autowired private lateinit var bases: BaseAssignmentRepository
    @Autowired private lateinit var events: DomainEventPublisher
    @Autowired private lateinit var clock: Clock

    /** 선검사만 늘 "없다" — 두 요청이 동시에 선검사를 통과한 순간. */
    private val racing by lazy {
        val real = stays
        SavedStayService(
            object : SavedStayRepository by real {
                override fun existsByAccountAndExternal(accountId: java.util.UUID, externalSource: String, externalId: String) = false
            },
            bases, events, clock,
        )
    }

    private fun account() =
        accounts.save(Account.registerViaSocial(null, AgeMethod.SELF_DECLARED, null, Instant.parse("2026-08-01T00:00:00Z"))).id.value

    private fun cmd(name: String = "숙소", externalId: String? = "ext-1") = RegisterStayCommand(
        name, null, null, false, null, null, externalSource = externalId?.let { "LOCALDATA" }, externalId = externalId,
        registerRoute = RegisterRoute.PIN, memo = null,
    )

    @Test
    fun `같은 외부 숙소가 경합으로 두 번 저장되면 409 다`() {
        val acc = account()
        racing.register(acc, cmd())

        shouldThrow<ConflictDetected> { racing.register(acc, cmd()) }
    }

    /** 수정 전에는 이 22001 도 "이미 저장한 숙소입니다" 409 였다 — 원인이 가려져 아무도 상한을 고치지 않았다. */
    @Test
    fun `유니크가 아닌 위반(길이 초과)은 409 로 바꾸지 않고 그대로 올린다`() {
        val acc = account()

        shouldThrow<DataIntegrityViolationException> { racing.register(acc, cmd(name = "가".repeat(201), externalId = null)) }
    }
}
