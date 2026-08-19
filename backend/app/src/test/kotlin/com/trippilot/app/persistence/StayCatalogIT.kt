package com.trippilot.app.persistence

import com.trippilot.accommodationsearch.domain.AccommodationContentPort
import com.trippilot.testsupport.AbstractPostgresIntegrationTest
import io.kotest.matchers.ints.shouldBeGreaterThan
import io.kotest.matchers.shouldBe
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.test.context.TestPropertySource

/**
 * 숙소 정본(V2.26 + `R__seed_stay.sql`) 실 DB 검증.
 *
 * 여기서만 드러나는 것:
 * - **시드가 실제로 들어갔는가** — 12,782행짜리 생성 SQL 이 문법·제약·FK 를 통과하는지는 실 DB 만 안다
 * - **지역 조회가 코드로 도는가** — 사용자는 `제주`·`제주시`·`제주특별자치도` 를 섞어 보낸다
 * - **시도 롤업** — 코드 접두사라 시도를 고르면 그 안 시군구가 전부 잡혀야 한다
 *
 * `mode=db` 를 켠다 — 기본은 스텁이라 이 테스트가 실 경로를 안 타게 된다.
 */
@SpringBootTest
@TestPropertySource(properties = ["trippilot.stay.content.mode=db"])
class StayCatalogIT : AbstractPostgresIntegrationTest() {

    @Autowired private lateinit var jdbc: JdbcTemplate
    @Autowired private lateinit var content: AccommodationContentPort

    private fun count(where: String): Int =
        jdbc.queryForObject("SELECT count(*) FROM stay WHERE $where", Int::class.java)!!

    @Test
    fun `전국 숙소가 시드된다`() {
        count("true") shouldBeGreaterThan 10_000

        // 시도 16곳 전부에 숙소가 있어야 한다 — 한 곳이라도 비면 그 지역 검색이 통째로 0건이 된다.
        jdbc.queryForObject(
            "SELECT count(DISTINCT left(region_code, 2)) FROM stay", Int::class.java,
        )!! shouldBe 16
    }

    /** 여관·여인숙은 여행 숙소로 내보내지 않기로 했다(생성기 `EXCLUDED_TYPES`). */
    @Test
    fun `제외하기로 한 업태가 들어오지 않는다`() {
        count("stay_type IN ('여관', '여인숙')") shouldBe 0
        count("stay_type NOT IN ('호텔', '리조트', '생활숙박', '기타')") shouldBe 0
    }

    /**
     * 좌표계가 EPSG:5174(중부원점 TM)라 변환 없이 쓰면 위도가 198575 같은 값이 된다.
     * 국내 상자를 벗어나면 지도가 엉뚱한 곳을 그리고, 반경 검색이 전부 0건이 된다.
     */
    @Test
    fun `좌표가 국내 영역 안이다`() {
        count("lat NOT BETWEEN 32.9 AND 38.7 OR lng NOT BETWEEN 124.5 AND 132.0") shouldBe 0
    }

    /** 카탈로그에 없는 코드는 FK 가 막지만, NULL 로 새는 것은 FK 가 못 막는다. */
    @Test
    fun `모든 숙소에 지역 코드가 붙어 있다`() {
        count("region_code IS NULL") shouldBe 0
    }

    @Test
    fun `시군구 이름으로 조회된다`() {
        val found = content.search("종로구")

        found.stays.size shouldBeGreaterThan 0
        found.stays.all { it.region == "종로구" } shouldBe true
    }

    /**
     * **시도를 고르면 그 안이 전부 잡힌다.** 코드 접두사(`11` → `11110`…)라 성립한다.
     * 별칭도 같은 경로를 탄다 — 프론트는 `서울` 처럼 짧은 이름을 보낸다.
     */
    @Test
    fun `시도로 조회하면 하위 시군구가 모두 잡히고 별칭도 통한다`() {
        val byStandard = content.search("서울특별시").stays
        val byAlias = content.search("서울").stays

        byStandard.size shouldBeGreaterThan content.search("종로구").stays.size
        byAlias.size shouldBe byStandard.size
    }

    /**
     * **편의시설을 모른다는 사실이 값으로 나가야 한다.** LOCALDATA 는 그 칸이 없어 전부 빈 배열인데,
     * 그것을 "편의시설 없는 숙소"로 읽으면 사용자가 필터를 걸었을 때 0건이 거짓말이 된다(INV-4).
     */
    @Test
    fun `편의시설 미보유를 결과가 알린다`() {
        val found = content.search("제주특별자치도")

        found.stays.size shouldBeGreaterThan 0
        found.amenitiesKnown shouldBe false
        found.stays.all { it.amenities.isEmpty() } shouldBe true
    }

    /** 카탈로그에 없는 이름은 빈 결과다 — 지어낸 매칭으로 엉뚱한 지역 숙소를 보여주지 않는다. */
    @Test
    fun `모르는 지역명은 빈 결과다`() {
        content.search("Paris").stays.size shouldBe 0
    }
}
