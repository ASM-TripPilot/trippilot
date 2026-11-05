package com.trippilot.app

import io.kotest.matchers.shouldBe
import org.flywaydb.core.Flyway
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.TestInstance
import org.testcontainers.containers.PostgreSQLContainer
import org.testcontainers.junit.jupiter.Container
import org.testcontainers.junit.jupiter.Testcontainers
import java.sql.Connection
import java.sql.DriverManager
import java.util.UUID

/**
 * TRIP-1800 — **V2.91 의 L2 백필이 기존 계정에서 실제로 도는가.**
 *
 * 새로 뜨는 테스트 DB 는 동의 증적이 비어 있어 백필이 무엇을 써도 통과한다([GenerationSessionBackfillIT] 와 같은 이유).
 * 그래서 2.90 까지 올려 **온보딩 동의만 있고 L2 가 꺼진 계정**들을 심고, 2.91 을 적용해 확인한다.
 */
@Testcontainers
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
class LocationLegalConsentBackfillIT {

    companion object {
        @Container
        @JvmStatic
        val pg = PostgreSQLContainer("postgres:16-alpine").withDatabaseName("trippilot")
    }

    private fun conn(user: String, pw: String): Connection = DriverManager.getConnection(pg.jdbcUrl, user, pw)

    /** `R__` 반복 시드는 뺀다 — 이유는 [GenerationSessionBackfillIT.migrateTo]. */
    private fun migrateTo(version: String) = Flyway.configure()
        .dataSource(pg.jdbcUrl, "app_migrate", "app_migrate")
        .schemas("app").defaultSchema("app").createSchemas(false)
        .locations("classpath:db/migration")
        .repeatableSqlMigrationPrefix("__NONE__")
        .target(version)
        .load()
        .migrate()

    @Test
    fun `온보딩에서 위치 약관에 동의한 ACTIVE 계정만 L2 가 켜지고 법정 로그가 1줄 남는다`() {
        conn(pg.username, pg.password).use { c ->
            c.createStatement().use { s ->
                s.execute("CREATE ROLE app_migrate LOGIN PASSWORD 'app_migrate'")
                s.execute("CREATE ROLE app_user LOGIN PASSWORD 'app_user'")
                s.execute("CREATE SCHEMA IF NOT EXISTS app AUTHORIZATION app_migrate")
                s.execute("ALTER ROLE app_migrate IN DATABASE trippilot SET search_path = app")
                s.execute("ALTER ROLE app_user IN DATABASE trippilot SET search_path = app")
            }
        }

        migrateTo("2.90")

        val onboarded = UUID.randomUUID()   // GRANT, 상태 행 없음 → 켜진다
        val osOnly = UUID.randomUUID()      // GRANT, OS 미러만 있던 행 → 켜지고 OS 미러는 그대로
        val revoked = UUID.randomUUID()     // GRANT 뒤 REVOKE → 그대로 꺼짐
        val already = UUID.randomUUID()     // 설정에서 이미 켬 → 로그 추가 없음
        val leaving = UUID.randomUUID()     // 탈퇴 진행 중 → 건드리지 않음
        val never = UUID.randomUUID()       // 위치 약관 증적 없음 → 건드리지 않음
        conn("app_migrate", "app_migrate").use { c ->
            c.createStatement().use { s ->
                s.execute("INSERT INTO terms_version (terms_type, version, body, effective_at) VALUES ('LOCATION_TERMS', '1.0', 'b', now() - interval '1 day')")
                for (a in listOf(onboarded, osOnly, revoked, already, never)) {
                    s.execute("INSERT INTO account (account_id, age_method, age_confirmed_at) VALUES ('$a', 'SELF_DECLARED', now())")
                }
                s.execute("INSERT INTO account (account_id, age_method, age_confirmed_at, status) VALUES ('$leaving', 'SELF_DECLARED', now(), 'DELETION_PENDING')")
                for (a in listOf(onboarded, osOnly, revoked, already, leaving)) {
                    s.execute(grant(a, "now() - interval '2 hours'", "GRANT", "ONBOARDING"))
                }
                s.execute(grant(revoked, "now() - interval '1 hour'", "REVOKE", "SETTINGS"))
                s.execute("INSERT INTO location_consent_state (account_id, os_permission_mirror) VALUES ('$osOnly', 'GRANTED')")
                s.execute("INSERT INTO location_consent_state (account_id, legal_consent) VALUES ('$already', true)")
            }
        }

        migrateTo("2.91")

        conn("app_migrate", "app_migrate").use { c ->
            fun legal(a: UUID): Boolean? = c.createStatement().executeQuery(
                "SELECT legal_consent FROM location_consent_state WHERE account_id = '$a'",
            ).use { rs -> if (rs.next()) rs.getBoolean(1) else null }
            fun logs(a: UUID): List<String> = c.createStatement().executeQuery(
                "SELECT event_type || ':' || (detail->>'channel') || ':' || (detail->>'source') FROM location_legal_log WHERE account_id = '$a'",
            ).use { rs -> buildList { while (rs.next()) add(rs.getString(1)) } }

            legal(onboarded) shouldBe true
            logs(onboarded) shouldBe listOf("CONSENT_GRANTED:ONBOARDING:BACKFILL_TRIP_1800")

            legal(osOnly) shouldBe true
            c.createStatement().executeQuery("SELECT os_permission_mirror FROM location_consent_state WHERE account_id = '$osOnly'")
                .use { rs -> rs.next(); rs.getString(1) shouldBe "GRANTED" }

            legal(revoked) shouldBe null
            logs(revoked) shouldBe emptyList()

            legal(already) shouldBe true
            logs(already) shouldBe emptyList()

            legal(leaving) shouldBe null
            logs(leaving) shouldBe emptyList()

            legal(never) shouldBe null
        }
    }

    private fun grant(account: UUID, at: String, action: String, channel: String) =
        "INSERT INTO consent_record (account_id, terms_type, terms_version, action, occurred_at, channel) " +
            "VALUES ('$account', 'LOCATION_TERMS', '1.0', '$action', $at, '$channel')"
}
