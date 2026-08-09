package com.trippilot.app

import io.kotest.assertions.throwables.shouldThrow
import io.kotest.assertions.withClue
import io.kotest.matchers.collections.shouldContainAll
import io.kotest.matchers.shouldBe
import org.flywaydb.core.Flyway
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.TestInstance
import org.testcontainers.containers.PostgreSQLContainer
import org.testcontainers.junit.jupiter.Container
import org.testcontainers.junit.jupiter.Testcontainers
import java.sql.Connection
import java.sql.DriverManager
import java.sql.SQLException

/**
 * TRIP-147 — Flyway 마이그레이션 + 롤/권한 검증.
 * compose init(00-roles.sql) 을 대역하여 컨테이너에 app_migrate·app_user 롤을 만들고,
 * app_migrate 로 마이그레이션 → app_user 권한(시퀀스 USAGE·append-only REVOKE)을 실 DB로 검증한다.
 */
@Testcontainers
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
class SchemaMigrationIT {

    companion object {
        @Container
        @JvmStatic
        val pg = PostgreSQLContainer("postgres:16-alpine").withDatabaseName("trippilot")
    }

    private fun conn(user: String, pw: String): Connection =
        DriverManager.getConnection(pg.jdbcUrl, user, pw)

    @Test
    fun `마이그레이션 적용 후 테이블 생성 + app_user 시퀀스INSERT + append-only 회수`() {
        // 1) 롤·스키마 부트스트랩 (인프라/compose init 대역)
        conn(pg.username, pg.password).use { c ->
            c.createStatement().use { s ->
                s.execute("CREATE ROLE app_migrate LOGIN PASSWORD 'app_migrate'")
                s.execute("CREATE ROLE app_user LOGIN PASSWORD 'app_user'")
                s.execute("CREATE SCHEMA IF NOT EXISTS app AUTHORIZATION app_migrate")
                s.execute("ALTER ROLE app_migrate IN DATABASE trippilot SET search_path = app")
                s.execute("ALTER ROLE app_user IN DATABASE trippilot SET search_path = app")
            }
        }

        // 2) Flyway 마이그레이션 (app_migrate = 스키마 소유자)
        Flyway.configure()
            .dataSource(pg.jdbcUrl, "app_migrate", "app_migrate")
            .schemas("app")
            .defaultSchema("app")
            .createSchemas(false) // 스키마는 위에서 선생성 (app_migrate 는 DB CREATE 권한 없음)
            .locations("classpath:db/migration")
            .load()
            .migrate()

        // 3) U1 전 테이블 생성 확인
        conn("app_migrate", "app_migrate").use { c ->
            val tables = mutableSetOf<String>()
            c.createStatement().executeQuery(
                "SELECT tablename FROM pg_tables WHERE schemaname = 'app'",
            ).use { rs -> while (rs.next()) tables.add(rs.getString(1)) }

            tables shouldContainAll listOf(
                "account", "social_identity", "terms_version", "consent_record",
                "marketing_consent", "location_consent_state", "location_legal_log",
                "refresh_session", "deletion_schedule", "profile", "preference_set",
                "banned_word_dictionary", "outbox_event", "shedlock",
                "change_log_entry", // 변경 이력(V2.11 · TRIP-275)
                "itinerary_revision", // 편집 이력·되돌리기(V2.14 · TRIP-310)
            )

            // R__ 시드 적용 확인 — 약관 6종 + 활성 금칙어 사전 1개
            c.createStatement().executeQuery("SELECT count(*) FROM terms_version").use { rs ->
                rs.next(); rs.getInt(1) shouldBe 6
            }
            c.createStatement().executeQuery(
                "SELECT count(*) FROM banned_word_dictionary WHERE active",
            ).use { rs -> rs.next(); rs.getInt(1) shouldBe 1 }

            // 3b) AI 가 채우는 텍스트 컬럼의 상한 — 코드가 이 길이에 맞춰 자른다.
            // 컬럼만 줄이고 자르는 쪽을 안 고치면 varchar 초과로 저장이 통째로 실패한다(실제로 한 번 겪었다).
            // 여기 값을 바꿔야 한다면 itinerary-generation 의 BoundedText 상수도 같이 바꿔야 한다.
            // (BoundedText 는 internal 이라 app 모듈에서 참조할 수 없어 길이를 여기에 적어 둔다.)
            mapOf(
                "visit_slot" to mapOf(
                    "distance_range" to 60,      // BoundedText.DISTANCE_RANGE_MAX
                    "placement_reason" to 500,   // BoundedText.PLACEMENT_REASON_MAX
                    "violation_reason" to 300,   // BoundedText.VIOLATION_REASON_MAX
                ),
                "itinerary_revision" to mapOf(
                    "summary" to 200,            // BoundedText.REVISION_SUMMARY_MAX
                    "detail" to 500,             // BoundedText.REVISION_DETAIL_MAX
                ),
            ).forEach { (table, columns) ->
                columns.forEach { (column, expected) ->
                    c.prepareStatement(
                        "SELECT character_maximum_length FROM information_schema.columns " +
                            "WHERE table_schema = 'app' AND table_name = ? AND column_name = ?",
                    ).use { ps ->
                        ps.setString(1, table)
                        ps.setString(2, column)
                        ps.executeQuery().use { rs ->
                            withClue("$table.$column 상한이 바뀌었다 — BoundedText 상수도 같이 맞춰야 한다") {
                                rs.next() shouldBe true
                                rs.getInt(1) shouldBe expected
                            }
                        }
                    }
                }
            }
        }

        // 4) app_user 권한 검증
        conn("app_user", "app_user").use { c ->
            c.autoCommit = true

            // 4a) IDENTITY 컬럼 테이블 INSERT — 시퀀스 USAGE(HIGH 수정) 없으면 실패
            c.createStatement().execute(
                "INSERT INTO outbox_event(event_id, event_type, aggregate_type, aggregate_id, payload) " +
                    "VALUES (gen_random_uuid(), 'TestEvent', 'Account', '1', '{}'::jsonb)",
            )
            c.createStatement().execute(
                "INSERT INTO location_legal_log(account_id, event_type, detail) " +
                    "VALUES (gen_random_uuid(), 'COLLECTION', '{}'::jsonb)",
            )

            // 4b) append-only 강제 — location_legal_log UPDATE/DELETE 는 권한 거부
            shouldThrow<SQLException> {
                c.createStatement().execute("UPDATE location_legal_log SET event_type = 'USE'")
            }
            shouldThrow<SQLException> {
                c.createStatement().execute("DELETE FROM location_legal_log")
            }

            // 4c-2) 편집 이력도 append-only(V2.14) — 되돌리기는 새 행을 쌓지, 과거를 고치지 않는다(BR-U3-32)
            shouldThrow<SQLException> {
                c.createStatement().execute("UPDATE itinerary_revision SET summary = 'tampered'")
            }
            shouldThrow<SQLException> {
                c.createStatement().execute("DELETE FROM itinerary_revision")
            }

            // 4c) 변경 이력도 append-only(V2.11) — 남은 이력이 사후에 바뀌면 되짚는 근거가 못 된다
            shouldThrow<SQLException> {
                c.createStatement().execute("UPDATE change_log_entry SET reason = 'tampered'")
            }
            shouldThrow<SQLException> {
                c.createStatement().execute("DELETE FROM change_log_entry")
            }
        }

        // 5) 권한 카탈로그로도 append-only 재확인 (consent_record)
        conn("app_migrate", "app_migrate").use { c ->
            c.createStatement().executeQuery(
                "SELECT has_table_privilege('app_user', 'app.consent_record', 'INSERT') AS ins, " +
                    "has_table_privilege('app_user', 'app.consent_record', 'UPDATE') AS upd, " +
                    "has_table_privilege('app_user', 'app.consent_record', 'DELETE') AS del",
            ).use { rs ->
                rs.next()
                rs.getBoolean("ins") shouldBe true
                rs.getBoolean("upd") shouldBe false
                rs.getBoolean("del") shouldBe false
            }
        }
    }
}
