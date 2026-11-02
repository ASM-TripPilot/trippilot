package com.trippilot.app.persistence

import com.trippilot.placedata.domain.DataStatus
import com.trippilot.placedata.domain.Poi
import com.trippilot.placedata.domain.PoiCategory
import com.trippilot.placedata.domain.PoiRepository
import com.trippilot.placedata.domain.PoiSource
import com.trippilot.testsupport.AbstractPostgresIntegrationTest
import io.kotest.assertions.throwables.shouldThrow
import io.kotest.matchers.shouldBe
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.dao.DataIntegrityViolationException
import org.springframework.jdbc.core.JdbcTemplate
import java.time.Instant
import java.util.UUID

/**
 * poi.image_thumb_url 실 DB 검증(V2.87). 이 열은 배치가 채우는데 **수집이 같은 행을 다시 저장한다** —
 * toEntity/toDomain 이 열을 빠뜨리면 빌드는 초록인데 썸네일만 매일 밤 조용히 지워진다(인메모리 페이크는 재현 못 함).
 */
@SpringBootTest
class PoiImageThumbPersistenceIT : AbstractPostgresIntegrationTest() {

    @Autowired private lateinit var pois: PoiRepository
    @Autowired private lateinit var jdbc: JdbcTemplate

    // 공유 Testcontainers 라 넣은 행은 직접 치운다(PoiSourceRefPersistenceIT 와 같은 이유).
    @AfterEach
    fun cleanUpOwnRows() {
        jdbc.update("DELETE FROM poi WHERE name_ko LIKE '테스트장소-%'")
    }

    private val now: Instant = Instant.parse("2026-10-30T03:00:00Z")
    private val orig = "https://tong.visitkorea.or.kr/a.jpg"
    private val thumb = "https://img.example.net/poi/a.webp"

    private fun saved(): Poi {
        val p = Poi.reconstitute(
            poiId = UUID.randomUUID(), nameKo = "테스트장소-${UUID.randomUUID()}", lat = 35.15, lng = 129.12,
            category = PoiCategory.명소, region = "수영구", openingHours = null, dataStatus = DataStatus.ACTIVE,
            source = PoiSource.TOURAPI, savedCount = 0, createdAt = now, updatedAt = now,
            imageUrl = orig, sourceRef = "THUMB-${UUID.randomUUID()}", imageThumbUrl = thumb,
        )
        pois.saveAll(listOf(p))
        return p
    }

    private fun reload(p: Poi) = pois.findByIds(listOf(p.poiId)).single()

    private fun refresh(p: Poi, image: String?) = Poi.refreshed(
        existing = reload(p), nameKo = p.nameKo, lat = p.lat, lng = p.lng, category = p.category,
        region = p.region, openingHours = null, now = now, imageUrl = image,
    )

    @Test
    fun `썸네일 열이 저장과 조회를 왕복한다`() {
        reload(saved()).imageThumbUrl shouldBe thumb
    }

    @Test
    fun `같은 원본으로 재수집해 다시 저장해도 썸네일이 남는다`() {
        val p = saved()
        pois.saveAll(listOf(refresh(p, orig)))

        reload(p).imageThumbUrl shouldBe thumb
    }

    @Test
    fun `원본이 바뀌어 재수집되면 썸네일이 비고 화면에는 새 원본이 나간다`() {
        val p = saved()
        pois.saveAll(listOf(refresh(p, "https://tong.visitkorea.or.kr/b.jpg")))

        val after = reload(p)
        after.imageThumbUrl shouldBe null
        after.displayImageUrl shouldBe "https://tong.visitkorea.or.kr/b.jpg"
    }

    @Test
    fun `https 가 아닌 썸네일 주소는 DB 가 막는다`() {
        val p = saved()

        shouldThrow<DataIntegrityViolationException> {
            jdbc.update("UPDATE poi SET image_thumb_url = 'http://insecure/x.webp' WHERE poi_id = ?", p.poiId)
        }
    }
}
