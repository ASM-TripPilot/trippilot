package com.trippilot.app.persistence

import com.trippilot.placedata.adapter.out.persistence.PoiJpaRepository
import com.trippilot.placedata.application.PoiQueryService
import com.trippilot.placedata.domain.DataStatus
import com.trippilot.placedata.domain.Poi
import com.trippilot.placedata.domain.PoiCategory
import com.trippilot.placedata.domain.PoiRepository
import com.trippilot.placedata.domain.PoiSource
import com.trippilot.testsupport.AbstractPostgresIntegrationTest
import io.kotest.matchers.collections.shouldNotContainDuplicates
import io.kotest.matchers.shouldBe
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.jdbc.core.JdbcTemplate
import java.time.Instant
import java.util.UUID

/**
 * `제주` 장소 검색(TRIP-1723) — 카탈로그가 시도(50)와 제주시(50110)를 함께 돌려주는 이름.
 *
 * 실 DB 에서만 드러나는 것: 조회가 `substring(region_code, 1, len)` 이라 덮임 판정이 그 의미와 같아야 결과가 같다.
 * 커서로 끝까지 넘겨 받은 결과가 "region_code 가 50 으로 시작하는 ACTIVE" 전부와 같고, 중복이 없고,
 * 순서가 시도 한 쿼리([50])와 같아야 한다.
 */
@SpringBootTest
class PoiRegionPrefixIT : AbstractPostgresIntegrationTest() {

    @Autowired private lateinit var jdbc: JdbcTemplate
    @Autowired private lateinit var pois: PoiRepository
    @Autowired private lateinit var jpa: PoiJpaRepository
    @Autowired private lateinit var query: PoiQueryService

    @AfterEach
    fun cleanUpOwnRows() {
        jdbc.update("DELETE FROM poi WHERE name_ko LIKE '테스트장소-1723-%'")
    }

    private val now: Instant = Instant.parse("2026-11-03T00:00:00Z")

    private fun poi(name: String, regionCode: String, status: DataStatus = DataStatus.ACTIVE) = Poi.reconstitute(
        poiId = UUID.randomUUID(), nameKo = "테스트장소-1723-$name", lat = 33.5, lng = 126.5,
        category = PoiCategory.자연, region = "제주", openingHours = null, dataStatus = status,
        source = PoiSource.MANUAL, savedCount = 0, createdAt = now, updatedAt = now, regionCode = regionCode,
    )

    private fun seed() {
        pois.saveAll(
            (1..9).map { poi("시$it", "50110") } + (1..7).map { poi("서$it", "50130") } +
                listOf(poi("부산", "26440"), poi("닫힘", "50110", DataStatus.CLOSED)),
        )
    }

    @Test
    fun `제주를 커서로 끝까지 넘기면 50 으로 시작하는 ACTIVE 전부가 중복 없이 시도 한 쿼리 순서로 나온다`() {
        seed()
        val expected = jdbc.queryForList(
            "select poi_id from poi where data_status = 'ACTIVE' and region_code like '50%'", UUID::class.java,
        )

        val pages = generateSequence(query.search("제주", null, limit = 4)) { p ->
            p.nextCursor?.let { query.search("제주", null, cursor = it, limit = 4) }
        }.toList()
        val got = pages.flatMap { it.items }.map { it.poiId }

        got.shouldNotContainDuplicates()
        got.toSet() shouldBe expected.toSet()
        got shouldBe pois.findActive(listOf("50"), null, "", null, 10_000).map { it.poiId }
    }

    /**
     * 전후 지연 측정 — 옵트인(`MEASURE_POI_REGION=1`). 이전 경로(길이별 두 쿼리 + 앱 병합 정렬)를 같은 저장소로 재연한다.
     * 단언하지 않는다(머신마다 다르다). 수치는 PR 본문에 적는다.
     */
    @Test
    fun `측정 — 제주 첫 장 이전 두 쿼리 대 한 쿼리`() {
        if (System.getenv("MEASURE_POI_REGION") != "1") return
        val n = 3_000
        pois.saveAll((1..n).map { poi("측정$it", if (it % 2 == 0) "50110" else "50130") })
        val first = UUID(0, 0)
        fun old() = listOf(2 to listOf("50"), 5 to listOf("50110"))
            .flatMap { (len, codes) -> jpa.findActiveByRegionPrefixes(len, codes, null, "", -1, "", first, 51, "") }
            .distinctBy { it.poiId }.sortedBy { it.nameKo }.take(51)
        fun new() = jpa.findActiveByRegionPrefixes(2, listOf("50"), null, "", -1, "", first, 51, "")
        repeat(20) { old(); new() }   // 워밍업
        fun p50(f: () -> Any): Double = (1..100).map { val t = System.nanoTime(); f(); (System.nanoTime() - t) / 1e6 }.sorted()[50]
        println("MEASURE poi-region rows=$n old_p50_ms=${"%.2f".format(p50(::old))} new_p50_ms=${"%.2f".format(p50(::new))}")
    }
}
