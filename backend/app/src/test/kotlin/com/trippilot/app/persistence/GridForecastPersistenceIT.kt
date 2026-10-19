package com.trippilot.app.persistence

import com.trippilot.testsupport.AbstractPostgresIntegrationTest
import com.trippilot.weathercontext.domain.GridDay
import com.trippilot.weathercontext.domain.GridForecast
import com.trippilot.weathercontext.domain.GridForecastRepository
import com.trippilot.weathercontext.domain.GridHour
import io.kotest.assertions.throwables.shouldThrow
import io.kotest.matchers.shouldBe
import io.kotest.property.Arb
import io.kotest.property.arbitrary.arbitrary
import io.kotest.property.arbitrary.boolean
import io.kotest.property.arbitrary.choice
import io.kotest.property.arbitrary.double
import io.kotest.property.arbitrary.element
import io.kotest.property.arbitrary.int
import io.kotest.property.arbitrary.list
import io.kotest.property.arbitrary.long
import io.kotest.property.arbitrary.map
import io.kotest.property.arbitrary.orNull
import io.kotest.property.checkAll
import kotlinx.coroutines.runBlocking
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
import java.time.ZoneId
import java.time.temporal.ChronoUnit

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

    /**
     * PBT-02 왕복(nfr-requirements §8 ② — 위 예시를 생성 입력으로 일반화): 저장한 발표분은 같은 값으로 되읽힌다.
     *
     * 생성기가 반드시 담는 경계 — 오늘·내일·모레 정시와 자정 · 칸별 null(키를 두지 않는다) · PTY 0~4 · SKY 1·3·4 · 정수형 실수(18.0)·
     * 음수(−12.0)·소수(3.2)·임의 실수 · TMN·TMX null · 빈 시간별·날짜별 · 같은 격자 덮어쓰기(격자 키 5개를 돌려 써서 앞 발표분의 칸이
     * 남지 않는지도 본다).
     *
     * **허용 편차**: `-0.0` 은 `0.0` 으로 돌아올 수 있다(jsonb 의 수는 numeric 이라 음의 0 이 없다 — 판정 임계와 무관하다).
     * `fetchedAt` 은 µs 까지만 담긴다(timestamptz 정밀도) — 생성기도 µs 단위다.
     */
    @Test
    fun `jsonb 왕복 PBT — 생성한 발표분을 저장하면 같은 값으로 되읽는다`() {
        runBlocking {
            checkAll(generatedForecasts) { f ->
                grids.save(f)

                grids.find(f.gridKey)?.unsignedZeros() shouldBe f.unsignedZeros()
            }
        }
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

private val KST: ZoneId = ZoneId.of("Asia/Seoul")

/** 기온 — 경계 상수 · 소수 한 자리(원천의 꼴) · 범위 안 임의 실수. */
private val temperatures: Arb<Double> = Arb.choice(
    Arb.element(18.0, -12.0, 3.2, 0.0, -0.0, -60.0, 60.0),
    Arb.int(-600, 600).map { it / 10.0 },
    Arb.double(-60.0, 60.0),
)

private val winds: Arb<Double> = Arb.choice(Arb.element(0.0, 3.2, 14.0), Arb.int(0, 800).map { it / 10.0 }, Arb.double(0.0, 80.0))

private val hours: Arb<GridHour> = arbitrary {
    GridHour(
        pop = Arb.int(0, 100).orNull(0.2).bind(),
        pty = Arb.int(0, 4).orNull(0.2).bind(),
        sky = Arb.element(1, 3, 4).orNull(0.2).bind(),
        tmp = temperatures.orNull(0.2).bind(),
        wsd = winds.orNull(0.2).bind(),
    )
}

/** 한 발표분 — 발표 시각(KST 02·05·…·23시)의 날짜를 오늘로 두고 오늘·내일·모레 칸을 고른다. 격자 키는 실제 격자 밖(9xx). */
private val generatedForecasts: Arb<GridForecast> = arbitrary {
    val base = LocalDate.of(2026, 1, 1).plusDays(Arb.int(0, 730).bind().toLong())
        .atTime(Arb.element(2, 5, 8, 11, 14, 17, 20, 23).bind(), 0).atZone(KST).toInstant()
    val today = LocalDateTime.ofInstant(base, KST).toLocalDate()
    // 자정(0·24·48)을 따로 섞는다 — 균등 분포로는 드물다.
    val offsets = Arb.list(Arb.choice(Arb.element(0, 24, 48), Arb.int(0, 71)), 0..40).bind().toSet()
    GridForecast(
        gridKey = "90${Arb.int(5, 9).bind()},90${Arb.int(5, 9).bind()}",
        baseAt = base,
        hourly = offsets.associate { today.atStartOfDay().plusHours(it.toLong()) to hours.bind() },
        daily = (0L..2L).map { today.plusDays(it) }.filter { Arb.boolean().bind() }
            .associateWith { GridDay(tmn = temperatures.orNull(0.3).bind(), tmx = temperatures.orNull(0.3).bind()) },
        fetchedAt = base.plus(Arb.long(0L, Duration.ofHours(3).toNanos() / 1_000).bind(), ChronoUnit.MICROS),
        expiresAt = base.plus(Duration.ofMinutes(Arb.long(1L, 600L).bind())),
    )
}

/** 허용 편차 — `-0.0` 과 `0.0` 을 같게 둔다(jsonb numeric 에 음의 0 이 없다). */
private fun GridForecast.unsignedZeros(): GridForecast {
    fun Double?.u() = this?.let { if (it == 0.0) 0.0 else it }
    return copy(
        hourly = hourly.mapValues { (_, h) -> h.copy(tmp = h.tmp.u(), wsd = h.wsd.u()) },
        daily = daily.mapValues { (_, d) -> GridDay(d.tmn.u(), d.tmx.u()) },
    )
}
