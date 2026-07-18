package com.trippilot.app

import com.trippilot.testsupport.AbstractPostgresIntegrationTest
import io.kotest.matchers.shouldBe
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.context.SpringBootTest
import javax.sql.DataSource

/**
 * TRIP-147 — Spring Boot 자동설정이 기동 시 Flyway 마이그레이션을 실행하는지 검증(회귀 방지).
 * TRIP-149 — 공통 하네스(AbstractPostgresIntegrationTest) 재사용 예: 컨테이너·롤·Flyway 배선을 베이스가 제공.
 */
@SpringBootTest
class FlywayAutoConfigIT : AbstractPostgresIntegrationTest() {

    @Autowired
    lateinit var dataSource: DataSource

    @Test
    fun `자동설정이 기동 시 마이그레이션을 실행해 테이블이 생성된다`() {
        dataSource.connection.use { c ->
            c.createStatement().executeQuery(
                "SELECT count(*) FROM pg_tables WHERE schemaname = 'app' AND tablename = 'account'",
            ).use { rs ->
                rs.next()
                rs.getInt(1) shouldBe 1
            }
        }
    }
}
