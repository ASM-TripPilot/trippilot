package com.trippilot.app.persistence

import com.trippilot.placedata.application.PoiQueryService
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

    private fun insert(name: String): String {
        val id = UUID.randomUUID()
        jdbc.update(
            """
            INSERT INTO poi (poi_id, name_ko, lat, lng, category, region, data_status, source, saved_count)
            VALUES (?, ?, 37.5, 127.0, '명소', '서울-정렬IT', 'ACTIVE', 'MANUAL', 0)
            """.trimIndent(),
            id, name,
        )
        return name
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
}
