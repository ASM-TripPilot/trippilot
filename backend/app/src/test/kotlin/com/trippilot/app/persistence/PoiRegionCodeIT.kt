package com.trippilot.app.persistence

import com.trippilot.testsupport.AbstractPostgresIntegrationTest
import io.kotest.matchers.ints.shouldBeGreaterThan
import io.kotest.matchers.shouldBe
import io.kotest.matchers.string.shouldContain
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.assertThrows
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.dao.DataIntegrityViolationException
import org.springframework.jdbc.core.JdbcTemplate

/**
 * poi.region_code(V2.25 · TRIP-359) 실 DB 검증.
 *
 * 인메모리로는 **원리적으로** 못 보는 것들이다 — 외래키가 실제로 거부하는지, 마이그레이션 순서상
 * 시드가 카탈로그보다 나중에 도는지, 지워진 컬럼이 정말 없는지는 실 DB 만 안다.
 */
@SpringBootTest
class PoiRegionCodeIT : AbstractPostgresIntegrationTest() {

    @Autowired private lateinit var jdbc: JdbcTemplate

    private fun columnExists(table: String, column: String): Boolean =
        jdbc.queryForObject(
            "SELECT count(*) FROM information_schema.columns WHERE table_name = ? AND column_name = ?",
            Int::class.java, table, column,
        )!! > 0

    @Test
    fun `poi 에 region_code 가 있고 카탈로그를 참조한다`() {
        columnExists("poi", "region_code") shouldBe true

        // `information_schema.constraint_column_usage` 는 참조된 테이블의 소유자에게만 행을 보여줘
        // 앱 롤로 물으면 조용히 0이 나온다(실측). 카탈로그를 직접 본다.
        jdbc.queryForObject(
            """
            SELECT count(*) FROM pg_constraint c
            JOIN pg_class t ON t.oid = c.conrelid
            JOIN pg_class r ON r.oid = c.confrelid
            WHERE c.contype = 'f' AND t.relname = 'poi' AND r.relname = 'region'
            """.trimIndent(),
            Int::class.java,
        )!! shouldBeGreaterThan 0
    }

    /**
     * **카탈로그에 없는 코드는 저장되지 않는다.** 앱 검증만 두면 다른 경로로 들어온 값이 조용히 남고,
     * 그 뒤 커버리지 집계가 어느 지역에도 안 붙는 유령 코드를 센다.
     */
    @Test
    fun `카탈로그에 없는 코드는 거부된다`() {
        val e = assertThrows<DataIntegrityViolationException> {
            jdbc.update(
                """
                INSERT INTO poi (poi_id, name_ko, lat, lng, category, region_code,
                                 data_status, source, created_at, updated_at)
                VALUES (gen_random_uuid(), '없는지역', 33.0, 126.0, '자연', '99999',
                        'ACTIVE', 'MANUAL', now(), now())
                """.trimIndent(),
            )
        }
        e.message.orEmpty() shouldContain "region"
    }

    /**
     * 시드가 붙인 코드가 남아 있어야 한다 — `R__` 반복 시드는 카탈로그(`R__seed_region_catalog`)보다
     * **나중에** 돌아야 외래키에 걸리지 않는다. Flyway 는 반복 마이그레이션을 설명 문자열 순서로 돌리므로
     * 파일명이 곧 순서다. 이름을 바꾸면 여기서 깨진다.
     */
    @Test
    fun `스텁 시드에 시도 코드가 붙는다`() {
        jdbc.queryForObject(
            "SELECT count(*) FROM poi WHERE source = 'MANUAL' AND region = '제주' AND region_code = '50'",
            Int::class.java,
        )!! shouldBeGreaterThan 0

        // 시군구까지 내리지 않는다 — 시드가 아는 것은 '제주' 뿐이고, 기억으로 채우면 지어낸 값이 섞인다.
        jdbc.queryForObject(
            "SELECT count(*) FROM poi WHERE source = 'MANUAL' AND region = '제주' AND region_code <> '50'",
            Int::class.java,
        )!! shouldBe 0

        // **한 지역만 보지 않는다.** 처음엔 '제주'만 단언했다가 부산 8건이 코드 없이 남은 것을 실 DB
        // 커버리지 집계에서야 발견했다 — 시드에 지역이 늘면 조용히 빠진다. "남는 게 없다"로 묻는다.
        jdbc.queryForObject(
            "SELECT count(*) FROM poi WHERE source = 'MANUAL' AND region IS NOT NULL AND region_code IS NULL",
            Int::class.java,
        )!! shouldBe 0
    }

    /** 커버리지는 저장하지 않는다(조회 때 센다) — 컬럼이 남아 있으면 누군가 다시 그 값을 믿는다. */
    @Test
    fun `region 에 poi_count 컬럼이 남아 있지 않다`() {
        columnExists("region", "poi_count") shouldBe false
    }
}
