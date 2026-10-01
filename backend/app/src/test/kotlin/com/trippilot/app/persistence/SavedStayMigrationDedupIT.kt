package com.trippilot.app.persistence

import io.kotest.matchers.shouldBe
import org.flywaydb.core.Flyway
import org.junit.jupiter.api.Test
import org.testcontainers.containers.PostgreSQLContainer
import java.sql.DriverManager
import java.util.UUID

/**
 * V2.57 의 **기존 중복 정리 + 거점 참조 이동**을 실제 마이그레이션 재연으로 검증(TRIP-1059).
 *
 * 공유 컨테이너는 이미 최신 스키마라 중복을 넣을 수 없다(유니크가 막는다). 그래서 전용 컨테이너를
 * V2.56 까지만 올리고 → QA 실측과 같은 중복(같은 계정·외부 키 여러 행 + 거점 참조)을 심은 뒤 →
 * V2.57 을 적용해 "가장 이른 행만 남고 참조는 그 행을 가리킨다(FK 위반 0)"를 확인한다.
 * DEV/운영 DB 의 중복 여부가 미확인이라(티켓 '미확인') 이 정리 단계가 마이그레이션의 본체다.
 */
class SavedStayMigrationDedupIT {

    @Test
    fun `V2_57 - 계정·외부키당 가장 이른 행만 남고 거점 참조가 그 행으로 옮겨진다`() {
        PostgreSQLContainer("postgres:16-alpine").withDatabaseName("trippilot").use { c ->
            c.start()
            DriverManager.getConnection(c.jdbcUrl, c.username, c.password).use { conn ->
                conn.createStatement().use { s ->
                    s.execute("CREATE ROLE app_migrate LOGIN PASSWORD 'app_migrate'")
                    s.execute("CREATE ROLE app_user LOGIN PASSWORD 'app_user'") // V1.7 grants 가 요구한다
                    s.execute("CREATE SCHEMA IF NOT EXISTS app AUTHORIZATION app_migrate")
                    s.execute("ALTER ROLE app_migrate IN DATABASE ${c.databaseName} SET search_path = app")
                }
            }
            fun flyway(target: String?): Flyway = Flyway.configure()
                .dataSource(c.jdbcUrl, "app_migrate", "app_migrate")
                .schemas("app").defaultSchema("app").createSchemas(false)
                .locations("classpath:db/migration")
                .also { cfg -> target?.let { cfg.target(it) } }
                .load()

            flyway("2.56").migrate()

            val acc = UUID.randomUUID()
            val accB = UUID.randomUUID()
            val trip = UUID.randomUUID()
            val keeper = UUID.randomUUID()
            val dup2 = UUID.randomUUID()
            val dup3 = UUID.randomUUID()
            DriverManager.getConnection(c.jdbcUrl, "app_migrate", "app_migrate").use { conn ->
                fun stay(id: UUID, owner: UUID, extId: String?, createdAt: String) = conn.prepareStatement(
                    """
                    INSERT INTO saved_stay (saved_stay_id, account_id, name, lat, lng, coord_confirmed,
                                            external_source, external_id, register_route, created_at, updated_at)
                    VALUES (?, ?, '중복 호텔', 33.5, 126.5, true, ${if (extId == null) "NULL" else "'LOCALDATA'"}, ?, 'MAP_SEARCH',
                            '$createdAt'::timestamptz, now())
                    """.trimIndent(),
                ).use { it.setObject(1, id); it.setObject(2, owner); it.setString(3, extId); it.executeUpdate() }

                conn.prepareStatement("INSERT INTO account (account_id, age_method, age_confirmed_at) VALUES (?, 'SELF_DECLARED', now())")
                    .use { it.setObject(1, acc); it.executeUpdate() }
                conn.prepareStatement("INSERT INTO account (account_id, age_method, age_confirmed_at) VALUES (?, 'SELF_DECLARED', now())")
                    .use { it.setObject(1, accB); it.executeUpdate() }
                // QA 실측 모양: 같은 계정·같은 외부 키 3행(연타), 가장 이른 것이 keeper
                stay(keeper, acc, "X-1", "2026-09-27 16:59:34Z")
                stay(dup2, acc, "X-1", "2026-09-27 17:00:10Z")
                stay(dup3, acc, "X-1", "2026-09-27 17:01:36Z")
                // 경계: 외부 키 없는 행(핀)과 다른 계정의 같은 키는 정리 대상이 아니다
                stay(UUID.randomUUID(), acc, null, "2026-09-27 17:02:00Z")
                stay(UUID.randomUUID(), accB, "X-1", "2026-09-27 17:03:00Z")
                conn.prepareStatement(
                    """
                    INSERT INTO trip (trip_id, account_id, title, start_date, end_date, party, preference_snapshot)
                    VALUES (?, ?, '정리 검증', DATE '2026-10-01', DATE '2026-10-03', 2, '{}'::jsonb)
                    """.trimIndent(),
                ).use { it.setObject(1, trip); it.setObject(2, acc); it.executeUpdate() }
                // 거점 참조가 **중복 행 쪽**에 걸린 최악 케이스 — 마이그레이션이 keeper 로 옮겨야 한다
                conn.prepareStatement(
                    "INSERT INTO base_assignment (trip_id, saved_stay_id, date_from, date_to) VALUES (?, ?, DATE '2026-10-01', DATE '2026-10-03')",
                ).use { it.setObject(1, trip); it.setObject(2, dup2); it.executeUpdate() }
                conn.prepareStatement(
                    "INSERT INTO trip_base_day (trip_id, day_date, saved_stay_id, resolution) VALUES (?, DATE '2026-10-01', ?, 'auto')",
                ).use { it.setObject(1, trip); it.setObject(2, dup3); it.executeUpdate() }
            }

            flyway(null).migrate() // V2.57 적용 — 정리 + 유니크 생성

            DriverManager.getConnection(c.jdbcUrl, "app_migrate", "app_migrate").use { conn ->
                fun one(sql: String): Any? =
                    conn.prepareStatement(sql).use { ps -> ps.executeQuery().use { r -> r.next(); r.getObject(1) } }

                // 계정 A 의 X-1 은 keeper 1행만
                one("SELECT count(*) FROM saved_stay WHERE account_id = '$acc' AND external_id = 'X-1'") shouldBe 1L
                one("SELECT saved_stay_id FROM saved_stay WHERE account_id = '$acc' AND external_id = 'X-1'") shouldBe keeper
                // 경계 행들은 그대로
                one("SELECT count(*) FROM saved_stay WHERE account_id = '$acc' AND external_id IS NULL") shouldBe 1L
                one("SELECT count(*) FROM saved_stay WHERE account_id = '$accB'") shouldBe 1L
                // 참조는 keeper 로 이동(FK 위반 0 은 마이그레이션 커밋 성공 자체가 증거)
                one("SELECT saved_stay_id FROM base_assignment WHERE trip_id = '$trip'") shouldBe keeper
                one("SELECT saved_stay_id FROM trip_base_day WHERE trip_id = '$trip'") shouldBe keeper
                // 유니크가 실제로 물렸다
                one("SELECT count(*) FROM pg_indexes WHERE schemaname = 'app' AND indexname = 'ux_saved_stay_external'") shouldBe 1L
            }
        }
    }
}
