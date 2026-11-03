package com.trippilot.app.persistence

import com.trippilot.placedata.domain.DataStatus
import com.trippilot.placedata.domain.ImageLicense
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
 * poi.image_license 실 DB 검증(V2.88). enum 이름과 CHECK 어휘가 어긋나면 저장 자체가 실패하고,
 * toEntity/toDomain 이 열을 빠뜨리면 빌드는 초록인데 유형만 조용히 null 로 돌아온다 — 인메모리 페이크는 둘 다 못 본다.
 */
@SpringBootTest
class PoiImageLicensePersistenceIT : AbstractPostgresIntegrationTest() {

    @Autowired private lateinit var pois: PoiRepository
    @Autowired private lateinit var jdbc: JdbcTemplate

    // 공유 Testcontainers 라 넣은 행은 직접 치운다(PoiImageThumbPersistenceIT 와 같은 이유).
    @AfterEach
    fun cleanUpOwnRows() {
        jdbc.update("DELETE FROM poi WHERE name_ko LIKE '테스트장소-%'")
    }

    private val now: Instant = Instant.parse("2026-11-02T03:00:00Z")

    private fun saved(license: ImageLicense?): Poi {
        val p = Poi.reconstitute(
            poiId = UUID.randomUUID(), nameKo = "테스트장소-${UUID.randomUUID()}", lat = 37.58, lng = 126.97,
            category = PoiCategory.명소, region = "종로구", openingHours = null, dataStatus = DataStatus.ACTIVE,
            source = PoiSource.TOURAPI, savedCount = 0, createdAt = now, updatedAt = now,
            imageUrl = "https://tong.visitkorea.or.kr/a.jpg", sourceRef = "LIC-${UUID.randomUUID()}", imageLicense = license,
        )
        pois.saveAll(listOf(p))
        return p
    }

    private fun reload(p: Poi) = pois.findByIds(listOf(p.poiId)).single()

    @Test
    fun `유형 열이 저장과 조회를 왕복한다 — 모름(null) 포함`() {
        reload(saved(ImageLicense.TYPE3)).imageLicense shouldBe ImageLicense.TYPE3
        reload(saved(ImageLicense.TYPE1)).imageLicense shouldBe ImageLicense.TYPE1
        reload(saved(null)).imageLicense shouldBe null
    }

    @Test
    fun `원문 표기(Type3)나 모르는 값은 DB 가 막는다`() {
        val p = saved(null)

        shouldThrow<DataIntegrityViolationException> {
            jdbc.update("UPDATE poi SET image_license = 'Type3' WHERE poi_id = ?", p.poiId)
        }
    }
}
