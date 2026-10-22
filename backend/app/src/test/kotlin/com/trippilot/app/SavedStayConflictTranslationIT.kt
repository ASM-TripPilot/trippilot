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
import io.kotest.matchers.shouldBe
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.dao.DataIntegrityViolationException
import org.springframework.transaction.support.TransactionSynchronizationManager
import org.springframework.transaction.support.TransactionTemplate
import java.time.Clock
import java.time.Instant

/**
 * 저장 숙소 등록의 제약 위반 번역은 **유니크 경합만** 409 다(TRIP-1473). 판정 순서(드라이버 필드 → Hibernate)는 단위 테스트
 * (`ConstraintViolationTest`)가, 실 DB 에서 유니크 위반만 409 라는 점은 이 IT 가 본다.
 *
 * 선검사(`existsByAccountAndExternal`)를 거짓으로 돌려 경합 순간을 재현한다 — 저장은 실 어댑터(saveAndFlush)다.
 *
 * **운영 트랜잭션 경계 안에서 돈다.** 서비스를 직접 만들면 `@Transactional` 프록시를 타지 않아, 어댑터가 `saveAndFlush` 를
 * `save` 로 되돌려도(TRIP-1059 퇴행) 위반이 그 자리에서 터져 초록이었다. 운영에서는 flush 가 바깥 커밋까지 미뤄져 서비스의
 * catch 를 비껴가고 500 이 된다. 그래서 등록을 [TransactionTemplate] 안에서 부른다 — 이 IT 가 그 경계 안에서 `saveAndFlush`
 * 의 **즉시 위반**을 지킨다.
 */
@SpringBootTest
class SavedStayConflictTranslationIT : AbstractPostgresIntegrationTest() {

    @Autowired private lateinit var accounts: AccountRepository
    @Autowired private lateinit var stays: SavedStayRepository
    @Autowired private lateinit var bases: BaseAssignmentRepository
    @Autowired private lateinit var events: DomainEventPublisher
    @Autowired private lateinit var clock: Clock
    @Autowired private lateinit var tx: TransactionTemplate

    /** 운영처럼 바깥 트랜잭션 안에서 부른다 — 경계가 실제로 열렸는지 한 번 확인한다. */
    private fun <T> inTransaction(block: () -> T): T = tx.execute {
        TransactionSynchronizationManager.isActualTransactionActive() shouldBe true
        block()
    }!!

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
        inTransaction { racing.register(acc, cmd()) }

        shouldThrow<ConflictDetected> { inTransaction { racing.register(acc, cmd()) } }
    }

    /** 수정 전에는 이 22001 도 "이미 저장한 숙소입니다" 409 였다 — 원인이 가려져 아무도 상한을 고치지 않았다. */
    @Test
    fun `유니크가 아닌 위반(길이 초과)은 409 로 바꾸지 않고 그대로 올린다`() {
        val acc = account()

        shouldThrow<DataIntegrityViolationException> {
            inTransaction { racing.register(acc, cmd(name = "가".repeat(201), externalId = null)) }
        }
    }
}
