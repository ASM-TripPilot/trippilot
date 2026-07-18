package com.trippilot.testsupport

import org.springframework.test.context.DynamicPropertyRegistry
import org.testcontainers.containers.PostgreSQLContainer
import java.sql.DriverManager

/**
 * 통합 테스트용 PostgreSQL 지원 — 싱글톤 컨테이너(전 IT 재사용) + 롤·스키마 부트스트랩(compose init 대역).
 * 최초 접근 시 1회 기동·부트스트랩되고 JVM 종료 시 Testcontainers(Ryuk)가 정리한다.
 */
object PostgresSupport {

    val container: PostgreSQLContainer<*> by lazy {
        PostgreSQLContainer("postgres:16-alpine")
            .withDatabaseName("trippilot")
            .also {
                it.start()
                bootstrapRoles(it)
            }
    }

    /**
     * app_migrate(스키마 소유·마이그레이션) / app_user(런타임) 롤 + app 스키마 생성.
     * search_path 를 app 으로 고정(compose init 대역) — 미한정 SQL/JPA 가 app 스키마를 본다.
     */
    private fun bootstrapRoles(c: PostgreSQLContainer<*>) {
        DriverManager.getConnection(c.jdbcUrl, c.username, c.password).use { conn ->
            conn.createStatement().use { s ->
                s.execute("CREATE ROLE app_migrate LOGIN PASSWORD 'app_migrate'")
                s.execute("CREATE ROLE app_user LOGIN PASSWORD 'app_user'")
                s.execute("CREATE SCHEMA IF NOT EXISTS app AUTHORIZATION app_migrate")
                s.execute("ALTER ROLE app_migrate IN DATABASE ${c.databaseName} SET search_path = app")
                s.execute("ALTER ROLE app_user IN DATABASE ${c.databaseName} SET search_path = app")
            }
        }
    }

    /**
     * @SpringBootTest 통합 스펙용 프로퍼티 등록 — 런타임=app_user / 마이그레이션=app_migrate,
     * Flyway 활성(테스트 기본값 false 오버라이드)해 컨텍스트 기동 시 스키마가 준비된다.
     */
    fun registerSpringProperties(registry: DynamicPropertyRegistry) {
        val c = container
        registry.add("spring.datasource.url") { c.jdbcUrl }
        registry.add("spring.datasource.username") { "app_user" }
        registry.add("spring.datasource.password") { "app_user" }
        registry.add("spring.flyway.enabled") { "true" }
        registry.add("spring.flyway.user") { "app_migrate" }
        registry.add("spring.flyway.password") { "app_migrate" }
        registry.add("spring.flyway.schemas") { "app" }
        registry.add("spring.flyway.default-schema") { "app" }
        registry.add("spring.flyway.create-schemas") { "false" }
    }
}
