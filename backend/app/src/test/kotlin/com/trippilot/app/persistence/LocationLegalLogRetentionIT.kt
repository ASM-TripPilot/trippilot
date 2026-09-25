package com.trippilot.app.persistence

import com.trippilot.auth.adapter.out.persistence.LocationLegalLogJpaRepository
import com.trippilot.auth.application.LocationLegalLogRetentionSweeper
import com.trippilot.auth.domain.Account
import com.trippilot.auth.domain.AgeMethod
import com.trippilot.auth.domain.location.LocationLegalEvent
import com.trippilot.auth.domain.location.LocationLegalEventType
import com.trippilot.auth.domain.port.AccountRepository
import com.trippilot.auth.domain.port.LocationLegalLogRepository
import com.trippilot.testsupport.AbstractPostgresIntegrationTest
import io.kotest.matchers.collections.shouldHaveSize
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.context.SpringBootTest
import java.time.Duration
import java.time.Instant

/**
 * TRIP-881 — 위치 확인자료 보존기간(기록 시점부터 6개월, 위치정보법 제16조②) IT.
 *
 * 판정 기준이 DB 의 `now()`(V2.49 함수 내부)라 테스트 시각도 실제 현재 시각 기준 상대값을 쓴다 —
 * Clock 고정이 불가능한 자리다(고정하면 함수와 테스트가 서로 다른 '지금'을 본다).
 *
 * 직접 DELETE 가 여전히 권한 거부인 것은 SchemaMigrationIT(4b)가 계속 잠근다 — 여기서는
 * "정의자 함수 경유로는 만료분만 지워진다"는 나머지 절반을 잠근다.
 */
@SpringBootTest
class LocationLegalLogRetentionIT : AbstractPostgresIntegrationTest() {

    @Autowired lateinit var accounts: AccountRepository
    @Autowired lateinit var legalLog: LocationLegalLogRepository
    @Autowired lateinit var legalLogJpa: LocationLegalLogJpaRepository
    @Autowired lateinit var sweeper: LocationLegalLogRetentionSweeper

    @Test
    fun `기록 6개월이 지난 확인자료만 파기된다 - 이내 행은 어떤 실행에도 줄지 않는다`() {
        val now = Instant.now()
        val account = accounts.save(Account.registerViaSocial(null, AgeMethod.SELF_DECLARED, null, now))
        fun append(at: Instant) = legalLog.append(
            LocationLegalEvent.of(account.id, LocationLegalEventType.COLLECTION, mapOf("scope" to "test"), at),
        )
        append(now.minus(Duration.ofDays(200))) // 만료 — 6개월(~183일) 경과
        append(now.minus(Duration.ofDays(1)))   // 보존 중

        sweeper.sweep()

        fun mine() = legalLogJpa.findAll().filter { it.accountId == account.id.value }
        val remaining = mine()
        remaining.shouldHaveSize(1) // 만료분만 사라진다
        // 불변식 — 반복 실행이 보존 중인 행을 건드리지 않는다(멱등)
        sweeper.sweep()
        mine().shouldHaveSize(1)
    }
}
