package com.trippilot.app.persistence

import com.trippilot.placedata.api.RegionLookupFacade
import com.trippilot.testsupport.AbstractPostgresIntegrationTest
import io.kotest.matchers.doubles.shouldBeGreaterThan
import io.kotest.matchers.ints.shouldBeGreaterThan as shouldBeGreaterThanInt
import io.kotest.matchers.doubles.shouldBeLessThan
import io.kotest.matchers.nulls.shouldNotBeNull
import io.kotest.matchers.shouldBe
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.jdbc.core.JdbcTemplate

/**
 * 지역 대표 좌표(`R__update_region_center.sql` · TRIP-384) 실 DB 검증.
 *
 * 이 좌표가 없으면 **숙소를 등록하지 않은 여행이 빈 일정**이 된다 — 앵커가 하나도 없어 AI 가
 * 422 로 거절하고, 폴백은 must_visit 만으로 일정을 만들기 때문이다.
 *
 * 여기서만 드러나는 것: 시드 **실행 순서**. Flyway 반복 마이그레이션은 설명 문자열 순이라
 * 숙소·POI 시드보다 뒤에 돌아야 계산할 원본이 있다. 파일명을 바꾸면 좌표가 빈 채 계산된다.
 */
@SpringBootTest
class RegionCenterIT : AbstractPostgresIntegrationTest() {

    @Autowired private lateinit var jdbc: JdbcTemplate
    @Autowired private lateinit var regions: RegionLookupFacade

    /**
     * **목적지로 고를 수 있는 지역은 전부 좌표가 있어야 한다.** 하나라도 비면 그 지역을 고른 사용자가
     * 숙소 없이 일정을 만들 때 빈 일정을 받는다. 행정구는 목적지가 아니라 대상이 아니다.
     */
    @Test
    fun `고를 수 있는 지역은 모두 대표 좌표를 가진다`() {
        jdbc.queryForObject(
            "SELECT count(*) FROM region WHERE selectable AND (lat IS NULL OR lng IS NULL)",
            Int::class.java,
        )!! shouldBe 0
    }

    /**
     * **목적지가 아닌 행정구에는 시도 중심을 채우지 않는다.**
     *
     * `수원시 장안구` 에 경기도 중심을 박으면 그 좌표는 장안구와 아무 상관이 없다. 아무도 그 지역을
     * 목적지로 고를 수 없으니 앵커도 필요 없다 — 없는 것을 있다고 말하지 않는다.
     *
     * (데이터가 실제로 있는 행정구는 자기 무게중심을 가질 수 있다. 여기서 막는 것은 **시도 중심 대입**이다.)
     */
    @Test
    fun `데이터 없는 행정구에 시도 중심을 대입하지 않는다`() {
        jdbc.queryForObject(
            """
            SELECT count(*) FROM region r JOIN region s ON s.region_code = r.sido_code
             WHERE NOT r.selectable AND r.lat IS NOT NULL
               AND r.region_code <> r.sido_code   -- 시도 자기 자신과의 조인 제외
               AND r.lat = s.lat AND r.lng = s.lng
            """.trimIndent(),
            Int::class.java,
        )!! shouldBe 0
    }

    /** 계산이 통째로 안 돌았는지(시드 순서 뒤바뀜) 잡는다 — 0건이면 원본이 없었다는 뜻이다. */
    @Test
    fun `좌표가 실제로 계산됐다`() {
        jdbc.queryForObject(
            "SELECT count(*) FROM region WHERE lat IS NOT NULL", Int::class.java,
        )!! shouldBeGreaterThanInt 200
    }

    /** 변환·집계가 틀어지면 좌표가 국내를 벗어난다 — 상자로 막는다. */
    @Test
    fun `모든 대표 좌표가 국내 영역 안이다`() {
        jdbc.queryForObject(
            """
            SELECT count(*) FROM region
             WHERE lat IS NOT NULL
               AND (lat NOT BETWEEN 32.9 AND 38.7 OR lng NOT BETWEEN 124.5 AND 132.0)
            """.trimIndent(),
            Int::class.java,
        )!! shouldBe 0
    }

    /** 대표 좌표가 그 지역 안에 있어야 한다 — 서울 중심이 부산에 찍히면 앵커가 무의미하다. */
    @Test
    fun `대표 좌표가 그 지역다운 위치에 있다`() {
        val seoul = regions.centerOf("서울특별시").shouldNotBeNull()
        seoul.lat shouldBeGreaterThan 37.4
        seoul.lat shouldBeLessThan 37.75
        seoul.lng shouldBeGreaterThan 126.7
        seoul.lng shouldBeLessThan 127.3

        val jeju = regions.centerOf("제주특별자치도").shouldNotBeNull()
        jeju.lat shouldBeLessThan 33.7
        jeju.lng shouldBeGreaterThan 126.1
    }

    /**
     * **제주 시도 중심은 제주시 시가지에 있다 — 한라산 북사면이 아니다**(TRIP-1225).
     *
     * 별칭 `제주`·`제주도` 가 시도(50)로 이어져, 숙소 없이 제주를 고른 여행은 이 좌표가 앵커다.
     * 점 평균은 남북 두 군집(제주시·서귀포) 사이 (33.389, 126.511) 산 위에 떨어졌고 2km 안에
     * 숙소·장소가 한 건도 없었다. 상자는 제주시 시가지(구도심·신제주·공항 일대)를 넉넉히 감싼다.
     */
    @Test
    fun `제주 시도 중심은 산 위가 아니라 제주시 시가지에 있다`() {
        val jeju = regions.centerOfCode("50").shouldNotBeNull()
        jeju.lat shouldBeGreaterThan 33.45
        jeju.lat shouldBeLessThan 33.53
        jeju.lng shouldBeGreaterThan 126.45
        jeju.lng shouldBeLessThan 126.58

        regions.centerOf("제주도") shouldBe jeju
    }

    /**
     * **시도 중심 2km 안에는 숙소나 장소가 있다 — 사람 없는 곳에 떨어지지 않는다**(TRIP-1225).
     *
     * 군집이 여럿인 시도에서 점 평균은 군집 사이 빈 땅에 떨어진다 — 시드 기준 16개 시도 중 10곳이
     * 평균 좌표 2km 안에 한 건도 없었다(제주 한라산·경북 내륙·강원 산간 …). 좌표값이 아니라 성질로
     * 묻는다 — 시드가 바뀌어도 밀집지 둘레에는 점이 있다. 중심이 없는 시도도 위반으로 센다.
     */
    @Test
    fun `시도 중심 2km 안에 숙소나 장소가 있다`() {
        jdbc.queryForObject(
            """
            SELECT count(*) FROM region r
             WHERE r.level = 'SIDO'
               AND NOT EXISTS (
                 SELECT 1
                   FROM (SELECT lat, lng FROM stay
                         UNION ALL
                         SELECT lat, lng FROM poi WHERE data_status = 'ACTIVE') p
                  WHERE sqrt(power((p.lat - r.lat) * 111.0, 2)
                           + power((p.lng - r.lng) * 111.0 * cos(radians(r.lat)), 2)) <= 2.0
               )
            """.trimIndent(),
            Int::class.java,
        )!! shouldBe 0
    }

    /** 별칭으로도 찾혀야 한다 — 프론트는 `서울` 처럼 짧은 이름을 보낸다. */
    @Test
    fun `별칭으로도 대표 좌표를 찾는다`() {
        val byAlias = regions.centerOf("서울").shouldNotBeNull()
        val byName = regions.centerOf("서울특별시").shouldNotBeNull()

        byAlias.lat shouldBe byName.lat
    }

    /** 모르는 이름은 null — 지어낸 좌표를 주지 않는다. */
    @Test
    fun `모르는 지역명은 좌표가 없다`() {
        regions.centerOf("Paris") shouldBe null
    }
}
