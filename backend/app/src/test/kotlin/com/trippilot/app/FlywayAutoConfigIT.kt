package com.trippilot.app

import io.kotest.matchers.shouldBe
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.test.context.DynamicPropertyRegistry
import org.springframework.test.context.DynamicPropertySource
import org.testcontainers.containers.PostgreSQLContainer
import org.testcontainers.junit.jupiter.Container
import org.testcontainers.junit.jupiter.Testcontainers
import java.sql.DriverManager
import javax.sql.DataSource

/**
 * TRIP-147 — Spring Boot 자동설정이 기동 시 Flyway 마이그레이션을 실행하는지 검증(회귀 방지).
 * SB4.0 은 자동설정을 모듈로 분리했으므로 spring-boot-flyway 모듈이 빠지면 마이그레이션이 조용히 스킵된다.
 * 이 테스트는 실제 자동설정 경로(런타임 app_user / 마이그레이션 app_migrate 분리)를 그대로 태운다.
 */
@SpringBootTest
@Testcontainers
class FlywayAutoConfigIT {

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

    companion object {
        @Container
        @JvmStatic
        val pg = PostgreSQLContainer("postgres:16-alpine").withDatabaseName("trippilot")

        @JvmStatic
        @DynamicPropertySource
        fun props(registry: DynamicPropertyRegistry) {
            // 롤·스키마 부트스트랩 (compose init 대역) — 컨텍스트 기동 전 실행
            DriverManager.getConnection(pg.jdbcUrl, pg.username, pg.password).use { c ->
                c.createStatement().use { s ->
                    s.execute("CREATE ROLE app_migrate LOGIN PASSWORD 'app_migrate'")
                    s.execute("CREATE ROLE app_user LOGIN PASSWORD 'app_user'")
                    s.execute("CREATE SCHEMA IF NOT EXISTS app AUTHORIZATION app_migrate")
                }
            }
            // 런타임 = app_user, 마이그레이션 = app_migrate (application.yml 과 동일 구조)
            registry.add("spring.datasource.url") { pg.jdbcUrl }
            registry.add("spring.datasource.username") { "app_user" }
            registry.add("spring.datasource.password") { "app_user" }
            registry.add("spring.flyway.enabled") { "true" } // 테스트 기본값(false) 오버라이드
            registry.add("spring.flyway.user") { "app_migrate" }
            registry.add("spring.flyway.password") { "app_migrate" }
            registry.add("spring.flyway.schemas") { "app" }
            registry.add("spring.flyway.default-schema") { "app" }
            registry.add("spring.flyway.create-schemas") { "false" }
        }
    }
}
