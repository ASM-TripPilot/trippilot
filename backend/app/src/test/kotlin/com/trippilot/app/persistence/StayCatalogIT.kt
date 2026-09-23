package com.trippilot.app.persistence

import com.trippilot.accommodationsearch.domain.AccommodationContentPort
import com.trippilot.testsupport.AbstractPostgresIntegrationTest
import io.kotest.assertions.throwables.shouldThrow
import io.kotest.matchers.ints.shouldBeGreaterThan
import io.kotest.matchers.shouldBe
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.core.io.ClassPathResource
import org.springframework.dao.DataIntegrityViolationException
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.test.context.TestPropertySource

/**
 * 숙소 정본(V2.26 + `R__seed_stay.sql`) 실 DB 검증.
 *
 * 여기서만 드러나는 것:
 * - **시드가 실제로 들어갔는가** — 1만 행을 넘는 생성 SQL 이 문법·제약·FK 를 통과하는지는 실 DB 만 안다
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

    /**
     * **지역을 안 고르면 상한이 걸린다.** 정본이 1만 곳을 넘어 전량을 실으면 탐색 탭이 열리는 것만으로
     * 수 MB 가 나간다 — FE `explore.tsx` 가 인자 없이 부른다. 스텁(5곳) 시절에는 없던 문제다.
     *
     * 자른 사실을 값으로 알려야 한다. 뒤따르는 필터가 부분집합 위에서 돌기 때문에,
     * 조용히 자르면 "조건에 맞는 숙소가 없다"가 사실이 아닐 수 있다.
     */
    @Test
    fun `지역을 안 고르면 상한을 걸고 잘랐다고 알린다`() {
        val all = content.search(null)

        all.stays.size shouldBe 200
        all.truncated shouldBe true
    }

    /** 지역을 고르면 그 안은 전부 준다 — 상한은 전국 조회에만 건다. */
    @Test
    fun `지역을 고르면 자르지 않는다`() {
        content.search("종로구").truncated shouldBe false
    }

    /**
     * **행정구가 있는 일반시도 조회돼야 한다.**
     *
     * 숙소를 `수원시 장안구`(41111) 코드로 저장하면, 사용자가 고를 수 있는 `수원시`(41110)로 조회할 때
     * 접두사가 안 맞아 **0건**이 된다 — 41111 은 41110 으로 시작하지 않는다. 그래서 생성기가 행정구를
     * 상위 시로 접는다(POI 쪽 `RegionResolver` 와 같은 규칙).
     *
     * 처음 검수 때 `종로구`·`서울`·`제주` 로만 확인해 **행정구 없는 지역만 표본에 있었고** 놓쳤다.
     * 경기도만 9개 시가 해당한다.
     */
    @Test
    fun `행정구가 있는 일반시로도 숙소가 조회된다`() {
        listOf("수원시", "성남시", "창원시", "청주시", "포항시").forEach { city ->
            content.search(city).stays.size shouldBeGreaterThan 0
        }
    }

    /** 목적지로 고를 수 없는 코드에는 숙소가 붙어 있으면 안 된다 — 그 코드로는 아무도 조회하지 않는다. */
    @Test
    fun `고를 수 없는 지역 코드에 숙소가 저장되지 않는다`() {
        jdbc.queryForObject(
            """
            SELECT count(*) FROM stay s JOIN region r ON r.region_code = s.region_code
            WHERE NOT r.selectable
            """.trimIndent(),
            Int::class.java,
        )!! shouldBe 0
    }

    /** 카탈로그에 없는 이름은 빈 결과다 — 지어낸 매칭으로 엉뚱한 지역 숙소를 보여주지 않는다. */
    @Test
    fun `모르는 지역명은 빈 결과다`() {
        content.search("Paris").stays.size shouldBe 0
    }

    // ── V2.51 주소·전화·객실 ────────────────────────────────────────────────

    /**
     * **주소는 전량이다.** LOCALDATA 가 인허가 대장이라 주소가 필수 기재이고, 생성기도 주소를
     * 못 읽으면 그 행을 지역 미해결로 떨군다. 하나라도 비면 생성기가 칸을 잘못 읽은 것이다.
     */
    @Test
    fun `모든 숙소에 주소가 있다`() {
        count("address IS NULL OR address = ''") shouldBe 0
    }

    /**
     * **전화번호는 그대로 `tel:` 에 실린다.** 원본은 하이픈 없는 숫자열(`0222677474`)이라
     * 생성기가 지역번호 길이를 보고 끊는다 — 그 규칙이 무너지면 화면에 `0222677474` 가 나가고
     * 링크도 엉뚱한 번호로 걸린다. 형식이 깨진 값은 저장 자체를 하지 않는 편이 낫다.
     */
    @Test
    fun `전화번호가 표시 형식을 지킨다`() {
        // 국번은 2~4자리다 — 서울 `02`, 일반 `031`, 안심번호 `0507`.
        count("phone IS NOT NULL AND phone !~ '^0[0-9]{1,3}-[0-9]{3,4}-[0-9]{4}$'") shouldBe 0
    }

    /**
     * **형식만 보면 가짜를 놓친다.** `069-3564-9718`·`060-473-8988` 은 위 형식 검사를 그대로
     * 통과하지만 **실재하지 않는 국번**이다(원본의 깨진 값이 그럴듯하게 묶인 것 — 실측 2건).
     * 060 은 정보이용료 번호라 사용자가 누르면 요금이 붙는다.
     *
     * 그래서 생성기가 국번 화이트리스트로 거르는데, 그 규칙이 생성기 안에만 있으면 회귀했을 때
     * 아무도 모른다 — 형식 검사는 그때도 초록이다. 여기서 바깥에서 한 번 더 센다.
     */
    @Test
    fun `실재하지 않는 국번이 저장되지 않는다`() {
        count(
            """
            phone IS NOT NULL AND split_part(phone, '-', 1) NOT IN (
              '02',
              '031','032','033','041','042','043','044',
              '051','052','053','054','055','061','062','063','064',
              '070','010',
              '0502','0503','0504','0505','0506','0507','0508'
            )
            """.trimIndent(),
        ) shouldBe 0
    }

    /**
     * **국번(지역번호 다음 3~4자리)은 0·1 로 시작하지 않는다.**
     *
     * 국번 화이트리스트(위)를 통과하고도 새는 가짜가 있었다 — `02-0773-8803`(0 으로 시작하는
     * 국번은 존재하지 않는다) 과 `02-1644-xxxx`(지역번호가 잘못 붙은 전국대표번호). 둘 다
     * 형식 검사도 지역번호 검사도 통과한다. 실측 35건이었고 생성기가 이제 NULL 로 버린다.
     *
     * 이동전화(010)·인터넷전화(070)·안심번호(050X)는 이 규칙을 따르지 않으므로 제외한다 —
     * `010-1234-5678`·`0507-136-6446` 은 정상이다.
     */
    @Test
    fun `유선 국번이 0이나 1로 시작하지 않는다`() {
        count(
            """
            phone IS NOT NULL
              AND split_part(phone, '-', 1) NOT IN ('010', '070')
              AND split_part(phone, '-', 1) NOT LIKE '050_'
              AND left(split_part(phone, '-', 2), 1) IN ('0', '1')
            """.trimIndent(),
        ) shouldBe 0
    }

    /**
     * **폐업한 곳이 정본에서 사라져야 한다 — upsert 만으로는 영원히 남는다.**
     *
     * 시드는 `INSERT … ON CONFLICT DO UPDATE` 라 **지우는 절이 없으면** 원본에서 빠진 행이
     * 그대로 남는다. 2026-09-22 갱신에서 21곳이 빠졌는데, 그대로 두면 문 닫은 숙소가 계속
     * 검색에 뜨고 이제는 **전화번호까지 달려 있어** 사용자가 없는 곳에 전화를 건다.
     *
     * **빈 DB 로는 원리적으로 못 본다.** Testcontainers 에는 지울 대상이 애초에 없다.
     * 그래서 원본에 없는 LOCALDATA 행을 과거 시각으로 심고 시드를 다시 태운다.
     */
    @Test
    fun `원본에서 빠진 숙소는 시드 재실행이 지운다`() {
        try {
            jdbc.update(
                """
                INSERT INTO stay (external_source, external_id, name, lat, lng, region, region_code, stay_type, updated_at)
                VALUES ('LOCALDATA', 'gone-0001', '폐업한 숙소', 37.57, 126.98, '종로구', '11110', '호텔', now() - interval '1 day')
                """.trimIndent(),
            )
            count("external_id = 'gone-0001'") shouldBe 1

            val seed = ClassPathResource("db/migration/R__seed_stay.sql")
                .inputStream.use { it.readBytes().toString(Charsets.UTF_8) }
            jdbc.execute(seed)

            count("external_id = 'gone-0001'") shouldBe 0
        } finally {
            jdbc.update("DELETE FROM stay WHERE external_source = 'LOCALDATA' AND external_id = 'gone-0001'")
        }
    }

    /**
     * **채움률이 무너지면 알아야 한다.** 원본 실측이 54.8%(7,005곳)다. 생성기가 칸 이름을 잘못
     * 읽거나 정규화가 과하게 버리면 이 수가 조용히 0 에 가까워지는데, 형식 검사(위)는 그때도
     * 초록이다 — 남은 값이 전부 올바른 형식이기 때문이다.
     */
    @Test
    fun `전화번호 채움률이 급락하지 않았다`() {
        count("phone IS NOT NULL") shouldBeGreaterThan 6_000
    }

    /**
     * **0 은 들어오면 안 된다.** 원본에서 양실·한실이 둘 다 빈 행이 59건 있는데, 합을 그대로 쓰면
     * 0 이 되어 "객실 0개인 숙소"가 화면에 나간다(미기재와 구분 불가). 생성기가 NULL 로 넘기지만
     * 그 규칙을 생성기 안에만 두면 회귀했을 때 아무도 모른다 — DB 제약이 바깥에서 한 번 더 막는다.
     *
     * **인메모리 대역으로는 못 보는 검사다.** CHECK 가 실제로 무는지는 실 DB 만 안다.
     */
    @Test
    fun `객실 수 0은 제약이 막는다`() {
        try {
            shouldThrow<DataIntegrityViolationException> {
                jdbc.update(
                    """
                    INSERT INTO stay (external_source, external_id, name, lat, lng, region, region_code, stay_type, rooms)
                    VALUES ('TEST', 'rooms-zero', '객실0 테스트', 37.57, 126.98, '종로구', '11110', '호텔', 0)
                    """.trimIndent(),
                )
            }
        } finally {
            // **정리는 finally 에 있어야 한다.** 제약이 물지 않으면 위에서 바로 죽어 DELETE 를 못 밟고,
            // 남은 행(주소 NULL)이 `모든 숙소에 주소가 있다` 까지 같이 빨갛게 만든다 — 역검증에서 실제로 그랬다.
            jdbc.update("DELETE FROM stay WHERE external_source = 'TEST' AND external_id = 'rooms-zero'")
        }
    }

    /**
     * **시드 재실행이 새 칸을 되채우는가 — 이 IT 의 나머지가 못 보는 경로다.**
     *
     * Testcontainers 는 빈 DB 라 시드가 `INSERT` 경로만 탄다. 그런데 실제 환경(DEV·로컬)에는
     * 정본 행이 이미 있어 재실행은 **전부 `ON CONFLICT DO UPDATE` 로 간다.** 생성기의 INSERT 절만
     * 고치고 그 절을 빠뜨리면 마이그레이션은 컬럼을 만들고 시드는 통과하는데 **값이 영원히 NULL 로
     * 남는다** — 빌드도 위 검사들도 전부 초록이다.
     *
     * 그래서 한 행만 비우고 시드를 실제로 다시 태워 되돌아오는지 본다(전량을 비우면 실패했을 때
     * 다른 테스트의 원인까지 덮는다).
     */
    @Test
    fun `시드를 다시 실행하면 이미 있는 행의 새 칸도 되채워진다`() {
        val before = jdbc.queryForMap(
            """
            SELECT external_source, external_id, address, phone, rooms FROM stay
            WHERE phone IS NOT NULL AND rooms IS NOT NULL AND address IS NOT NULL
            ORDER BY external_id LIMIT 1
            """.trimIndent(),
        )
        val source = before["external_source"]
        val id = before["external_id"]

        val after = try {
            jdbc.update(
                "UPDATE stay SET address = NULL, phone = NULL, rooms = NULL WHERE external_source = ? AND external_id = ?",
                source, id,
            )
            count("external_id = '$id' AND address IS NULL") shouldBe 1

            val seed = ClassPathResource("db/migration/R__seed_stay.sql")
                .inputStream.use { it.readBytes().toString(Charsets.UTF_8) }
            jdbc.execute(seed)

            jdbc.queryForMap(
                "SELECT address, phone, rooms FROM stay WHERE external_source = ? AND external_id = ?",
                source, id,
            )
        } finally {
            // **실패해도 원상복구한다.** 안 하면 비운 행이 남아 같은 컨테이너를 쓰는 다른 검사
            // (`모든 숙소에 주소가 있다`)까지 같이 빨개져 원인이 어느 쪽인지 안 보인다.
            jdbc.update(
                "UPDATE stay SET address = ?, phone = ?, rooms = ? WHERE external_source = ? AND external_id = ?",
                before["address"], before["phone"], before["rooms"], source, id,
            )
        }

        after["address"] shouldBe before["address"]
        after["phone"] shouldBe before["phone"]
        after["rooms"] shouldBe before["rooms"]
    }
}
