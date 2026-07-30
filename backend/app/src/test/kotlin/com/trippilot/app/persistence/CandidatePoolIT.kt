package com.trippilot.app.persistence

import com.trippilot.placedata.api.Area
import com.trippilot.placedata.api.CandidatePoolPort
import com.trippilot.placedata.application.PoiCollectionService
import com.trippilot.placedata.domain.Area as CollectArea
import com.trippilot.testsupport.AbstractPostgresIntegrationTest
import io.kotest.matchers.shouldBe
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.context.SpringBootTest
import java.util.UUID

/**
 * TRIP-213 — CandidatePoolPort 실 DB E2E. 수집(스텁) 후 지역/반경 resolve·ground 검증(closed-set·미확인 제외).
 */
@SpringBootTest
class CandidatePoolIT : AbstractPostgresIntegrationTest() {

    @Autowired private lateinit var pool: CandidatePoolPort
    @Autowired private lateinit var collection: PoiCollectionService

    @Test
    fun `수집 후 지역 resolve — ACTIVE 후보(좌표 미확보 배제)`() {
        collection.collect(CollectArea("부산"))
        val names = pool.resolve(Area.Region("부산"), emptySet()).map { it.nameKo }
        names.contains("자갈치시장") shouldBe true
        names.contains("해운대해수욕장") shouldBe true
        names.contains("좌표없는후보") shouldBe false // 게이트 배제(INV-1)
    }

    @Test
    fun `반경 resolve — 3km 내만(해운대 배제)·distanceM 채움`() {
        collection.collect(CollectArea("부산"))
        val got = pool.resolve(Area.Radius(35.0965, 129.0306, 3000.0), emptySet()) // 자갈치 중심
        got.map { it.nameKo }.contains("자갈치시장") shouldBe true
        got.map { it.nameKo }.contains("해운대해수욕장") shouldBe false // ~13km
        got.all { it.distanceM != null && it.distanceM!! <= 3000.0 } shouldBe true
    }

    @Test
    fun `ground — ACTIVE만, 없는 id 제외`() {
        collection.collect(CollectArea("부산"))
        val jagalchi = pool.resolve(Area.Region("부산"), setOf("맛집")).first { it.nameKo == "자갈치시장" }
        val grounded = pool.ground(listOf(jagalchi.poiId, UUID.randomUUID()))
        grounded.map { it.poiId }.contains(jagalchi.poiId) shouldBe true
        grounded.none { it.nameKo == "" } shouldBe true
        grounded.size shouldBe 1 // 없는 id는 그라운딩 안 됨
    }
}
