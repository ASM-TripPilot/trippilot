package com.trippilot.app.persistence

import com.trippilot.testsupport.AbstractPostgresIntegrationTest
import io.kotest.matchers.ints.shouldBeGreaterThan
import io.kotest.matchers.shouldBe
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.jdbc.core.JdbcTemplate

/**
 * 행정구역 카탈로그(V2.24 + `R__seed_region_catalog.sql`) 실 DB 검증.
 *
 * 여기서만 드러나는 것:
 * - **시드가 실제로 들어갔는가** — 생성 스크립트가 만든 SQL 이 문법·제약을 통과하는지는 실 DB 만 안다
 * - **재실행 멱등** — `R__` 은 체크섬이 바뀌면 매번 다시 돈다. 중복이 생기면 자동완성이 같은 지역을 두 번 보인다
 * - **`selectable` 규칙** — 도(道)는 범위가 넓어 목적지가 아니고, 광역시·특별자치시는 목적지다
 *
 * 커버리지(`poi_count`)는 여기서 보지 않는다 — 저장하지 않고 조회 때 센다(V2.25 · TRIP-359).
 */
@SpringBootTest
class RegionCatalogIT : AbstractPostgresIntegrationTest() {

    @Autowired private lateinit var jdbc: JdbcTemplate

    private fun count(where: String, vararg args: Any): Int =
        jdbc.queryForObject("SELECT count(*) FROM region WHERE $where", Int::class.java, *args)!!

    @Test
    fun `시도 16개가 들어간다 — 세종 포함`() {
        count("level = 'SIDO'") shouldBe 16

        // 세종은 시군구가 없는 단층제라 법정동코드가 3611000000 이다. XX00000000 패턴으로만 거르면
        // 통째로 빠진다 — 실제로 한 번 놓쳤던 자리다.
        count("region_code = '36' AND name = '세종특별자치시'") shouldBe 1
    }

    @Test
    fun `시군구가 200곳 넘게 들어가고 홍천군이 있다`() {
        count("level = 'SIGUNGU'") shouldBeGreaterThan 200

        // 이 부모 티켓의 출발점이 "홍천을 고를 수 없다" 였다.
        count("name = '홍천군' AND selectable") shouldBe 1
    }

    /**
     * 도(道)는 목적지가 아니다 — 강원 전체를 고르면 POI 후보가 흩어져 일정 품질이 떨어진다.
     * 전남광주통합특별시는 이름이 '특별시'지만 옛 전라남도 전체를 포함하므로 도(道)로 다룬다.
     */
    @Test
    fun `도 단위는 목적지가 아니고 광역시·특별자치시는 목적지다`() {
        listOf("41" to "경기도", "51" to "강원특별자치도", "12" to "전남광주통합특별시").forEach { (code, name) ->
            count("region_code = ? AND name = ? AND NOT selectable", code, name) shouldBe 1
        }
        listOf("11" to "서울특별시", "26" to "부산광역시", "36" to "세종특별자치시", "50" to "제주특별자치도")
            .forEach { (code, name) ->
                count("region_code = ? AND name = ? AND selectable", code, name) shouldBe 1
            }
    }

    // 수원시 장안구 같은 일반시의 행정구는 여행지로 범위가 어긋난다 — 담되 고르지는 못하게.
    @Test
    fun `일반시의 행정구는 담기되 고를 수 없다`() {
        count("name = '수원시 장안구' AND level = 'SIGUNGU' AND NOT selectable") shouldBe 1
        count("name = '수원시' AND selectable") shouldBe 1
    }

    /**
     * 광주광역시·전라남도가 폐지되고 통합됐다. 표준명만 두면 사용자가 '광주'로 검색해도 안 잡힌다 —
     * 표시명을 손대면 표준과 갈라지므로 별칭으로 잇는다.
     */
    @Test
    fun `폐지된 옛 이름으로도 찾을 수 있다`() {
        val found = jdbc.queryForList(
            "SELECT r.name FROM region r JOIN region_alias a ON a.region_code = r.region_code WHERE a.alias = ?",
            String::class.java, "광주",
        )
        found shouldBe listOf("전남광주통합특별시")
    }

    @Test
    fun `코드가 중복되지 않는다`() {
        jdbc.queryForObject(
            "SELECT count(*) FROM (SELECT region_code FROM region GROUP BY region_code HAVING count(*) > 1) d",
            Int::class.java,
        ) shouldBe 0
    }

    /**
     * `R__` 은 체크섬이 바뀌면 매 기동 다시 돈다. 중복이 생기면 자동완성이 같은 지역을 두 번 보인다.
     * 시드 본문을 그대로 한 번 더 실행해 행수가 그대로인지 본다.
     */
    @Test
    fun `시드를 다시 적용해도 행이 늘지 않는다`() {
        val before = count("true")

        jdbc.execute(
            """
            INSERT INTO region (region_code, name, sido_code, sido_name, level, selectable)
            VALUES ('11', '서울특별시', '11', '서울특별시', 'SIDO', true)
            ON CONFLICT (region_code) DO UPDATE SET name = EXCLUDED.name, updated_at = now()
            """.trimIndent(),
        )

        count("true") shouldBe before
    }
}
