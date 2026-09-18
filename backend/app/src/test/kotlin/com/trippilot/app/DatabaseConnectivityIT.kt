package com.trippilot.app

import io.kotest.matchers.shouldBe
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.boot.testcontainers.service.connection.ServiceConnection
import org.testcontainers.containers.PostgreSQLContainer
import org.testcontainers.junit.jupiter.Container
import org.testcontainers.junit.jupiter.Testcontainers
import javax.sql.DataSource

/**
 * TRIP-146 — Testcontainers 통합테스트 하네스 검증.
 * postgres:16 컨테이너를 띄우고 @ServiceConnection 으로 데이터소스를 배선,
 * 스프링 컨텍스트가 실제 DB에 연결되는지 확인한다(걷는 뼈대: "앱이 붙는 상태").
 */
@SpringBootTest
@Testcontainers
class DatabaseConnectivityIT {

    @Autowired
    lateinit var dataSource: DataSource

    @Test
    fun `컨텍스트가 실제 PostgreSQL 에 연결되어 쿼리를 수행한다`() {
        dataSource.connection.use { conn ->
            conn.isValid(2) shouldBe true
            conn.createStatement().use { stmt ->
                stmt.executeQuery("SELECT 1").use { rs ->
                    rs.next() shouldBe true
                    rs.getInt(1) shouldBe 1
                }
            }
        }
    }

    companion object {
        @Container
        @ServiceConnection
        @JvmStatic
        val postgres = PostgreSQLContainer("postgres:16-alpine")
    }
}
