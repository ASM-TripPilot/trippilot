package com.trippilot.app.persistence

import com.trippilot.testsupport.AbstractPostgresIntegrationTest
import com.trippilot.weathercontext.domain.GridDay
import com.trippilot.weathercontext.domain.GridForecast
import com.trippilot.weathercontext.domain.GridForecastRepository
import com.trippilot.weathercontext.domain.GridHour
import io.kotest.assertions.throwables.shouldThrow
import io.kotest.matchers.shouldBe
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.dao.DataIntegrityViolationException
import org.springframework.jdbc.core.JdbcTemplate
import java.sql.Timestamp
import java.time.Duration
import java.time.Instant
import java.time.LocalDate
import java.time.LocalDateTime

/**
 * weather_grid_forecast 실 DB 검증(설계서 T-IT-6 · V2.74) — 인메모리 대역이 원리적으로 못 보는 셋을 본다.
 *
 * - **jsonb 왕복** — JSON 을 실제로 한 번 통과시킨다(맵 왕복은 역직렬화 관용을 재지 않는다 — anti-patterns TRIP-854).
 * - **수 타입** — jsonb 를 되읽으면 정수·실수가 바뀐다. 손으로 적은 정수 기온·실수 강수확률도 같은 값으로 읽혀야 한다.
 * - **격자당 1행** — 같은 격자는 덮인다(Fake 는 Map 이라 늘 덮는다 — 하루 1행 보장은 DB 가 한다).
 *
 * 격자 키는 실제 격자 범위 밖 값(9xx)을 써서 다른 테스트·시드와 겹치지 않게 한다.
 */
@SpringBootTest
class GridForecastPersistenceIT : AbstractPostgresIntegrationTest() {

    @Autowired private lateinit var grids: GridForecastRepository
    @Autowired private lateinit var jdbc: JdbcTemplate

    private val base = Instant.parse("2026-10-19T23:00:00Z") // KST 10-20 08:00 발표
    private val expires = base.plus(Duration.ofMinutes(190))

    private fun forecast(key: String, pop: Int?, tmp: Double?) = GridForecast(
        gridKey = key,
        baseAt = base,
        hourly = mapOf(
            LocalDateTime.parse("2026-10-20T14:00") to GridHour(pop = pop, pty = 1, sky = 4, tmp = tmp, wsd = 3.2),
            // 모르는 칸이 섞인 시각 — 키를 두지 않고 저장하고, 되읽으면 null 이다
            LocalDateTime.parse("2026-10-21T00:00") to GridHour(pop = null, pty = 0, sky = null, tmp = -1.5, wsd = null),
        ),
        daily = mapOf(
            LocalDate.parse("2026-10-20") to GridDay(tmn = null, tmx = 21.0),
            LocalDate.parse("2026-10-21") to GridDay(tmn = -12.0, tmx = 3.0),
        ),
        fetchedAt = base.plusSeconds(700),
        expiresAt = expires,
    )

    @Test
    fun `jsonb 왕복 — 시간별·날짜별·모르는 칸이 저장 전과 같다`() {
        val saved = forecast("901,901", pop = 60, tmp = 18.0)

        grids.save(saved)

        grids.find("901,901") shouldBe saved
    }

    @Test
    fun `수 타입 — 정수로 적힌 기온·실수로 적힌 강수확률도 같은 값으로 읽는다`() {
        jdbc.update(
            """
            INSERT INTO weather_grid_forecast(grid_key, base_at, hourly, daily, fetched_at, expires_at)
            VALUES ('902,902', ?, '{"2026-10-20T14:00":{"pop":60.0,"pty":1,"sky":4,"tmp":18,"wsd":3}}'::jsonb,
                    '{"2026-10-20":{"tmn":-12,"tmx":21}}'::jsonb, ?, ?)
            """.trimIndent(),
            Timestamp.from(base), Timestamp.from(base), Timestamp.from(expires),
        )

        val read = grids.find("902,902")!!

        read.hourly[LocalDateTime.parse("2026-10-20T14:00")] shouldBe GridHour(pop = 60, pty = 1, sky = 4, tmp = 18.0, wsd = 3.0)
        read.daily[LocalDate.parse("2026-10-20")] shouldBe GridDay(tmn = -12.0, tmx = 21.0)
    }

    @Test
    fun `같은 격자는 덮인다 — 행이 늘지 않고 최신 발표분이 남는다`() {
        grids.save(forecast("903,903", pop = 30, tmp = 15.0))
        val next = forecast("903,903", pop = 80, tmp = 12.5).copy(
            baseAt = base.plus(Duration.ofHours(3)), expiresAt = expires.plus(Duration.ofHours(3)),
        )

        grids.save(next)

        jdbc.queryForObject("SELECT count(*) FROM weather_grid_forecast WHERE grid_key = '903,903'", Int::class.java) shouldBe 1
        grids.find("903,903") shouldBe next
    }

    @Test
    fun `없는 격자는 null 이다`() {
        grids.find("999,999") shouldBe null
    }

    /** 도메인이 먼저 막지만(require) DB 가 마지막 방어선이다 — 만료가 발표보다 이르면 발화 신선도 판정이 뒤집힌다. */
    @Test
    fun `만료가 발표보다 이르거나 같으면 DB 가 거절한다`() {
        shouldThrow<DataIntegrityViolationException> {
            jdbc.update(
                "INSERT INTO weather_grid_forecast(grid_key, base_at, hourly, daily, fetched_at, expires_at) VALUES ('904,904', ?, '{}'::jsonb, '{}'::jsonb, ?, ?)",
                Timestamp.from(base), Timestamp.from(base), Timestamp.from(base),
            )
        }.message!!.contains("chk_weather_grid_forecast_window") shouldBe true
    }
}
