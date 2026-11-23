package com.trippilot.app.persistence

import com.trippilot.placedata.application.PoiQueryService
import com.trippilot.placedata.domain.PoiCategory
import com.trippilot.testsupport.AbstractPostgresIntegrationTest
import io.kotest.matchers.collections.shouldContainExactly
import io.kotest.matchers.shouldBe
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.jdbc.core.JdbcTemplate
import java.util.UUID

/**
 * 탐색 정렬(TRIP-1003 (A)) 실 DB 검증 — **SQL 정렬식과 도메인(PoiSearchOrder) 식의 일치**를 잠근다.
 * keyset 커서는 도메인 식으로 만들고 정렬은 DB 가 하므로, 두 식이 어긋나면 이어받기에서 행이
 * 중복·누락된다 — 그 드리프트는 이 IT 의 커서 연속성 케이스만 잡을 수 있다.
 */
@SpringBootTest
class PlacesSearchOrderIT : AbstractPostgresIntegrationTest() {

    @Autowired private lateinit var places: PoiQueryService
    @Autowired private lateinit var jdbc: JdbcTemplate

    private fun insert(name: String, regionCode: String? = null): String {
        val id = UUID.randomUUID()
        jdbc.update(
            """
            INSERT INTO poi (poi_id, name_ko, lat, lng, category, region, region_code, data_status, source, saved_count)
            VALUES (?, ?, 37.5, 127.0, '명소', '서울-정렬IT', ?, 'ACTIVE', 'MANUAL', 0)
            """.trimIndent(),
            id, name, regionCode,
        )
        return name
    }

    private fun names(query: String, regionCode: String? = null) =
        places.search(region = null, category = null, query = query, regionCode = regionCode).items.map { it.nameKo }

    // ── 인덱스 경로(TRIP-1843) ─────────────────────────────────────────────
    // 2글자 이상 검색은 바이그램 조건이 먼저 후보를 좁힌다. 좁히는 조건이 like 보다 엄격하면 **조용히 덜 찾는다** —
    // 화면에는 "없다"로만 보인다. 그래서 like 가 찾던 것을 그대로 찾는지 본다.

    @Test
    fun `2글자 이상 검색은 인덱스로 좁혀도 부분 일치·대소문자 무시·공백을 그대로 찾는다`() {
        insert("바이그램IT숲길카페")
        insert("BIGRAMit Forest")

        names("숲길") shouldBe listOf("바이그램IT숲길카페")
        names("bigramIT f") shouldBe listOf("BIGRAMit Forest")
    }

    @Test
    fun `한 글자 검색은 조각이 없어도 찾는다`() {
        insert("囍바이그램IT")

        names("囍") shouldBe listOf("囍바이그램IT")
    }

    @Test
    fun `이름순은 한글 가나다순이다 - 정렬 키를 코드포인트로 비교한다`() {
        // en_US.utf8(운영 RDS) 에서는 "가야" 가 "소" 뒤로 갔다(로컬 glibc 실측). collate "C" 는 한글 음절을 가나다로 놓는다.
        // CI 의 alpine(musl)은 원래 C 처럼 정렬해 이 단정만으로는 collate 를 빼도 통과한다 — 회귀 방지용이고, 근거는 실험 기록이다.
        listOf("소가나다IT", "공원가나다IT", "가야가나다IT").forEach { insert(it) }

        names("가나다IT") shouldBe listOf("가야가나다IT", "공원가나다IT", "소가나다IT")
    }

    @Test
    fun `시도는 하위 시군구를 잡고 시군구는 자기만 잡는다 - 검색어가 있어도 없어도`() {
        insert("지역IT해운대", "26440")
        insert("지역IT동구", "26170")
        insert("지역IT종로", "11110")

        names("지역IT", "26") shouldBe listOf("지역IT동구", "지역IT해운대")
        names("지역IT", "26440") shouldBe listOf("지역IT해운대")
        names("I", "26").filter { it.startsWith("지역IT") } shouldBe listOf("지역IT동구", "지역IT해운대")
        names("지역IT", "11110") shouldBe listOf("지역IT종로")
        names("I", "26440").filter { it.startsWith("지역IT") } shouldBe listOf("지역IT해운대") // 시군구 · 바이그램 아님
    }

    @Test
    fun `카테고리를 함께 걸어도 여섯 경로가 같은 행을 준다`() {
        insert("분류IT바다", "26440")

        fun cat(q: String, code: String?) =
            places.search(region = null, category = PoiCategory.명소, query = q, regionCode = code).items.map { it.nameKo }.filter { it.startsWith("분류IT") }
        listOf(null, "26", "26440").forEach { code ->
            cat("분류IT", code) shouldBe listOf("분류IT바다")
            cat("I", code) shouldBe listOf("분류IT바다")
        }
        places.search(region = null, category = PoiCategory.맛집, query = "분류IT", regionCode = "26").items.size shouldBe 0
    }

    @Test
    fun `관련도순 - 정확 일치가 접두·부분 일치보다 먼저 온다(AC 그대로)`() {
        insert("명동IT")
        insert("명동IT교자")
        insert("광명동IT굴 푸드코트")

        val names = places.search(region = null, category = null, query = "명동IT").items.map { it.nameKo }

        names.take(3) shouldContainExactly listOf("명동IT", "명동IT교자", "광명동IT굴 푸드코트")
    }

    @Test
    fun `괄호 법인명이 첫 카드가 되지 않는다 - 정렬 키에서 접두를 뗀다`() {
        insert("(주)정렬IT수공예")
        insert("정렬IT가마솥")

        val names = places.search(region = null, category = null, query = "정렬IT").items.map { it.nameKo }

        // "정렬IT가마솥"(가) < "정렬IT수공예"(수) — 괄호를 떼고 비교했다는 증거
        names shouldContainExactly listOf("정렬IT가마솥", "(주)정렬IT수공예")
    }

    @Test
    fun `커서 이어받기 - 관련도 3축에서 행이 중복·누락되지 않는다(SQL·도메인 식 일치)`() {
        val all = listOf(
            insert("연속IT"), insert("연속IT카페"), insert("(주)연속IT공방"),
            insert("남연속IT식당"), insert("연속IT온천"),
        )

        val collected = mutableListOf<String>()
        var cursor: String? = null
        do {
            val page = places.search(region = null, category = null, query = "연속IT", cursor = cursor, limit = 2)
            collected += page.items.map { it.nameKo }
            cursor = page.nextCursor
        } while (cursor != null)

        collected.size shouldBe all.size // 누락 없음
        collected.toSet().size shouldBe all.size // 중복 없음
        // 정확(연속IT) → 접두(연속IT카페·(주)연속IT공방? — 접두는 원 이름 기준이라 "(주)…"는 부분) 순서 확인
        collected.first() shouldBe "연속IT"
    }

    // ── 무작위 정렬(TRIP-1570) ─────────────────────────────────────────────
    // 커서의 정렬 키는 도메인(JVM MessageDigest)이 만들고 정렬·비교는 DB(md5)가 한다 —
    // 두 md5 입력 바이트가 어긋나면 이 케이스만 중복·누락으로 드러난다.

    private fun drainRandom(seed: String, q: String, size: Int): List<String> {
        val collected = mutableListOf<String>()
        var cursor: String? = null
        var guard = 0
        do {
            val page = places.search(region = null, category = null, query = q, cursor = cursor, limit = size, order = "random", seed = seed)
            collected += page.items.map { it.nameKo }
            cursor = page.nextCursor
            guard++
        } while (cursor != null && guard < 50)
        return collected
    }

    @Test
    fun `무작위 커서 이어받기 - 같은 seed 면 중복·누락 없이 같은 순서(SQL md5 · 도메인 md5 일치)`() {
        val all = (1..9).map { insert("섞기IT-%02d".format(it)) }

        val paged = drainRandom("it-seed-1", "섞기IT", 2)
        val whole = drainRandom("it-seed-1", "섞기IT", 200)

        paged.size shouldBe all.size
        paged.toSet() shouldBe all.toSet()
        paged shouldBe whole
    }

    @Test
    fun `무작위 - seed 가 다르면 순서가 다르고 이름순도 아니다`() {
        val all = (1..12).map { insert("다른씨IT-%02d".format(it)) }

        val a = drainRandom("seed-a", "다른씨IT", 200)
        val b = drainRandom("seed-b", "다른씨IT", 200)

        a.toSet() shouldBe all.toSet()
        (a == b) shouldBe false
        (a == all.sorted()) shouldBe false
    }
}

