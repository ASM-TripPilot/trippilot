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
 * TRIP-403 — **V2.27 의 소급이 기존 행에서 실제로 도는가.**
 *
 * 다른 IT 는 이것을 원리적으로 못 본다. 테스트 DB 는 항상 새로 뜨므로 `generation_session` 이 비어
 * 있고, 빈 테이블에 대한 `UPDATE … FROM trip` 은 무엇을 써도 통과한다. 그 상태로 초록을 보면
 * **소급이 검증됐다고 착각한다.**
 *
 * 소급이 한 행이라도 놓치면 `SET NOT NULL` 에서 마이그레이션이 통째로 실패한다. 설령 통과하더라도
 * 계정이 빈 세션은 계정 조회에서 빠져 **동시 생성 제한을 조용히 우회한다.**
 *
 * 그래서 여기서만: 2.26 까지 올려 **컬럼이 없던 시절의 행**을 심고, 2.27 을 적용해 확인한다.
 * 싱글톤 컨테이너는 이미 최신까지 올라가 있어 쓸 수 없다(`SchemaMigrationIT` 와 같은 이유로 전용 컨테이너).
 */
@Testcontainers
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
class GenerationSessionBackfillIT {

    companion object {
        @Container
        @JvmStatic
        val pg = PostgreSQLContainer("postgres:16-alpine").withDatabaseName("trippilot")
    }

    private fun conn(user: String, pw: String): Connection = DriverManager.getConnection(pg.jdbcUrl, user, pw)

    /**
     * **`R__` 반복 시드는 뺀다.** Flyway 는 target 이 무엇이든 반복 마이그레이션을 그 집합 **끝에
     * 무조건** 붙인다. 그래서 2.26 까지만 올려도 `R__seed_stay.sql` 이 돌고, 그 시드가 2.26 시점에
     * 없는 컬럼을 쓰면 여기서 죽는다 — 실제로 V2.51(stay 주소·전화·객실)에서 그렇게 됐다.
     *
     * 그대로 두면 이 테스트가 **"V2.26 이후로 stay 에 컬럼을 추가하지 말라"** 는 뜻이 된다.
     * 시드는 이 테스트가 보려는 것(V2.27 소급)과 아무 상관이 없으므로 아예 해석 대상에서 뺀다 —
     * 어느 파일도 쓰지 않는 접두사를 줘서 반복 마이그레이션이 하나도 잡히지 않게 한다.
     * 덤으로 12,782행 시드를 매번 적재하던 것도 사라진다.
     */
    private fun migrateTo(version: String) = Flyway.configure()
        .dataSource(pg.jdbcUrl, "app_migrate", "app_migrate")
        .schemas("app").defaultSchema("app").createSchemas(false)
        .locations("classpath:db/migration")
        .repeatableSqlMigrationPrefix("__NONE__")
        .target(version)
        .load()
        .migrate()

    @Test
    fun `컬럼이 없던 시절의 세션도 계정을 얻는다`() {
        conn(pg.username, pg.password).use { c ->
            c.createStatement().use { s ->
                s.execute("CREATE ROLE app_migrate LOGIN PASSWORD 'app_migrate'")
                s.execute("CREATE ROLE app_user LOGIN PASSWORD 'app_user'")
                s.execute("CREATE SCHEMA IF NOT EXISTS app AUTHORIZATION app_migrate")
                s.execute("ALTER ROLE app_migrate IN DATABASE trippilot SET search_path = app")
                s.execute("ALTER ROLE app_user IN DATABASE trippilot SET search_path = app")
            }
        }

        migrateTo("2.26")

        val account = UUID.randomUUID()
        val trip = UUID.randomUUID()
        val running = UUID.randomUUID()
        val finished = UUID.randomUUID()
        conn("app_migrate", "app_migrate").use { c ->
            c.createStatement().use { s ->
                // 이 시점의 generation_session 에는 account_id 컬럼이 없다 — 소급이 채워야 할 상태다.
                s.execute(
                    """
                    INSERT INTO account (account_id, age_method, age_confirmed_at)
                      VALUES ('$account', 'SELF_DECLARED', now());
                    INSERT INTO trip (trip_id, account_id, title, start_date, end_date, party, preference_snapshot)
                      VALUES ('$trip', '$account', '제주 여행', DATE '2026-08-10', DATE '2026-08-12', 2, '{}'::jsonb);
                    INSERT INTO generation_session (session_id, trip_id, status, mode, started_at)
                      VALUES ('$running', '$trip', 'RUNNING', 'FULLY_AI', now());
                    INSERT INTO generation_session (session_id, trip_id, status, mode, started_at, finished_at)
                      VALUES ('$finished', '$trip', 'COMPLETED', 'FULLY_AI', now(), now());
                    """.trimIndent(),
                )
            }
        }

        migrateTo("2.27")

        conn("app_migrate", "app_migrate").use { c ->
            fun accountOf(session: UUID): String? =
                c.prepareStatement("SELECT account_id FROM generation_session WHERE session_id = ?").use { st ->
                    st.setObject(1, session)
                    st.executeQuery().use { rs -> if (rs.next()) rs.getString(1) else null }
                }

            // 진행 중이든 끝났든 모두 채워진다 — 하나라도 비면 SET NOT NULL 이 실패했을 것이다.
            accountOf(running) shouldBe account.toString()
            accountOf(finished) shouldBe account.toString()

            // 소급이 끝났으니 컬럼이 비어 있을 수 없다. 이후 NULL 이 새면 그 행은 계정 조회에서 빠진다.
            c.createStatement().executeQuery(
                """
                SELECT is_nullable FROM information_schema.columns
                 WHERE table_schema = 'app' AND table_name = 'generation_session' AND column_name = 'account_id'
                """.trimIndent(),
            ).use { rs -> rs.next(); rs.getString(1) shouldBe "NO" }
        }
    }
}
