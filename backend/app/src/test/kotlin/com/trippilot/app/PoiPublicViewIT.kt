package com.trippilot.app

import io.kotest.assertions.throwables.shouldThrow
import io.kotest.matchers.shouldBe
import io.kotest.matchers.string.shouldContain
import org.flywaydb.core.Flyway
import org.junit.jupiter.api.Test
import org.testcontainers.containers.PostgreSQLContainer
import org.testcontainers.junit.jupiter.Container
import org.testcontainers.junit.jupiter.Testcontainers
import java.sql.Connection
import java.sql.DriverManager
import java.sql.SQLException

/**
 * V2.77 — 도우미 장소 조회(NL2SQL) 뷰 `poi_public` 과 ai_user 권한.
 * ai_user 는 뷰만 읽고(ACTIVE 행·허용 열) 원본 poi 는 못 읽으며, 롤 설정(읽기 전용)이면 쓰기가 막힌다.
 * 롤 생성은 deploy/eks/bootstrap.sql(로컬 00-roles.sql) 대역이다.
 */
@Testcontainers
class PoiPublicViewIT {

    companion object {
        @Container
        @JvmStatic
        val pg = PostgreSQLContainer("postgres:16-alpine").withDatabaseName("trippilot")
    }

    private fun conn(user: String, pw: String): Connection = DriverManager.getConnection(pg.jdbcUrl, user, pw)

    @Test
    fun `ai_user 는 poi_public 의 ACTIVE 행·허용 열만 읽고 원본 poi 와 쓰기는 막힌다`() {
        conn(pg.username, pg.password).use { c ->
            c.createStatement().use { s ->
                s.execute("CREATE ROLE app_migrate LOGIN PASSWORD 'app_migrate'")
                s.execute("CREATE ROLE app_user LOGIN PASSWORD 'app_user'")
                s.execute("CREATE ROLE ai_user LOGIN PASSWORD 'ai_user'")
                s.execute("CREATE SCHEMA IF NOT EXISTS app AUTHORIZATION app_migrate")
                s.execute("GRANT USAGE ON SCHEMA app TO app_user, ai_user")
                s.execute("ALTER ROLE app_migrate IN DATABASE trippilot SET search_path = app")
                s.execute("ALTER ROLE ai_user IN DATABASE trippilot SET search_path = app")
                s.execute("ALTER ROLE ai_user IN DATABASE trippilot SET default_transaction_read_only = on")
            }
        }
        Flyway.configure()
            .dataSource(pg.jdbcUrl, "app_migrate", "app_migrate")
            .schemas("app").defaultSchema("app").createSchemas(false)
            .locations("classpath:db/migration")
            .load().migrate()

        conn("app_migrate", "app_migrate").use { c ->
            c.createStatement().use { s ->
                s.execute(
                    "INSERT INTO poi (name_ko, lat, lng, category, region, data_status, source, address, tags) VALUES " +
                        "('경복궁', 37.58, 126.97, '명소', '종로구', 'ACTIVE', 'TOURAPI', '서울특별시 종로구 사직로 161', '{요즘 인기}')," +
                        "('문 닫은 집', 37.57, 126.98, '맛집', '중구', 'CLOSED', 'TOURAPI', '서울특별시 중구 어딘가', '{}')",
                )
            }
        }

        conn("ai_user", "ai_user").use { c ->
            c.createStatement().use { s ->
                // R__ 시드 POI 도 있으니 이 테스트가 넣은 두 행만 본다
                s.executeQuery("SELECT name, sido, sigungu FROM poi_public WHERE name IN ('경복궁', '문 닫은 집')").use { rs ->
                    rs.next() shouldBe true
                    rs.getString(1) shouldBe "경복궁"
                    rs.getString(2) shouldBe "서울특별시"
                    rs.getString(3) shouldBe "종로구"
                    rs.next() shouldBe false // CLOSED 행은 뷰에 없다
                }
                shouldThrow<SQLException> { s.executeQuery("SELECT opening_hours FROM poi_public") }
                    .message shouldContain "opening_hours" // 시각 열은 뷰에 없다(INV-2)
            }
        }
        conn("ai_user", "ai_user").use { c ->
            shouldThrow<SQLException> { c.createStatement().executeQuery("SELECT name_ko FROM poi") }
                .message shouldContain "permission denied"
        }
        conn("ai_user", "ai_user").use { c ->
            shouldThrow<SQLException> { c.createStatement().execute("CREATE TABLE x (i int)") }
        }
    }
}
