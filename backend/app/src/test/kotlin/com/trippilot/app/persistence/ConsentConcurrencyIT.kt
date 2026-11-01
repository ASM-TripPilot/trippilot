package com.trippilot.app.persistence

import com.trippilot.auth.application.ConsentService
import com.trippilot.auth.domain.Account
import com.trippilot.auth.domain.AccountId
import com.trippilot.auth.domain.AgeMethod
import com.trippilot.auth.domain.consent.ConsentAction
import com.trippilot.auth.domain.consent.TermsType
import com.trippilot.auth.domain.port.AccountRepository
import com.trippilot.auth.domain.port.ConsentRecordRepository
import com.trippilot.auth.domain.port.TermsVersionRepository
import com.trippilot.testsupport.AbstractPostgresIntegrationTest
import io.kotest.matchers.shouldBe
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.transaction.PlatformTransactionManager
import org.springframework.transaction.support.TransactionTemplate
import java.time.Instant
import java.util.concurrent.Callable
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

/**
 * TRIP-1689 — 두 기기(앱·웹)가 같은 동의를 **동시에** 보내도 법적 증적은 한 줄이다.
 *
 * 단일 스레드 테스트는 "최신과 같으면 안 남긴다"만 본다. 두 요청이 함께 "최신과 다르다"고 읽으면 각자 INSERT 하므로
 * 실 DB 경합으로만 드러난다. 타이밍 운에 맡기지 않으려고 **테스트가 계정 잠금을 먼저 쥔 채** 요청들을 보낸다
 * (`GenerationSessionConcurrencyIT` 의 방식) — 잠금이 읽기 앞에 있으면 요청들은 줄을 서서 하나만 남기고,
 * 잠금이 없거나 읽기 뒤에 있으면 전부가 빈 증적을 읽어 둔 채 함께 쓴다.
 */
@SpringBootTest
class ConsentConcurrencyIT : AbstractPostgresIntegrationTest() {

    @Autowired private lateinit var service: ConsentService
    @Autowired private lateinit var records: ConsentRecordRepository
    @Autowired private lateinit var terms: TermsVersionRepository
    @Autowired private lateinit var accounts: AccountRepository
    @Autowired private lateinit var txManager: PlatformTransactionManager
    @Autowired private lateinit var jdbc: JdbcTemplate

    @Test
    fun `같은 개인화 동의를 동시에 세 번 보내도 증적은 1줄`() {
        val account = accounts.save(
            Account.registerViaSocial(null, AgeMethod.SELF_DECLARED, null, Instant.parse("2026-11-02T00:00:00Z")),
        ).id
        val version = terms.findCurrent(TermsType.PERSONALIZATION, Instant.now())!!.version
        // 풀이 4 라 테스트가 연결 하나를 쥐면 요청은 셋까지다.
        val attempts = 3
        val pool = Executors.newFixedThreadPool(attempts)

        val outcomes = try {
            TransactionTemplate(txManager).execute {
                records.lockAccount(account)
                val futures = List(attempts) {
                    pool.submit(
                        Callable {
                            runCatching { service.changeConsent(account, TermsType.PERSONALIZATION, ConsentAction.GRANT, version) }
                        },
                    )
                }
                Thread.sleep(1_000) // 요청들이 잠금 앞(잠금이 읽기 뒤라면 그 너머)까지 가도록
                futures
            }!!.map { it.get(30, TimeUnit.SECONDS) }
        } finally {
            pool.shutdownNow()
        }

        outcomes.count { it.isSuccess } shouldBe attempts // 진 쪽도 200 — 앱은 오류 응답을 처리하지 않는다
        countRecords(account) shouldBe 1
    }

    private fun countRecords(account: AccountId): Int = jdbc.queryForObject(
        "SELECT count(*) FROM consent_record WHERE account_id = ? AND terms_type = 'PERSONALIZATION'",
        Int::class.java, account.value,
    )!!
}
