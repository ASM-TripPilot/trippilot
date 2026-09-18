package com.trippilot.app.persistence

import com.trippilot.placedata.api.Area
import com.trippilot.placedata.api.CandidatePoolPort
import com.trippilot.placedata.application.PoiCollectionService
import com.trippilot.placedata.domain.Area as CollectArea
import com.trippilot.testsupport.AbstractPostgresIntegrationTest
import io.kotest.matchers.shouldBe
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.jdbc.core.JdbcTemplate
import java.util.UUID

/**
 * TRIP-213 — CandidatePoolPort 실 DB E2E. 수집(스텁) 후 지역/반경 resolve·ground 검증(closed-set·미확인 제외).
 */
@SpringBootTest
class CandidatePoolIT : AbstractPostgresIntegrationTest() {

    @Autowired private lateinit var cleanupJdbc: JdbcTemplate

    /**
     * **넣은 것을 치운다.** Testcontainers 는 전 IT 가 공유하는 싱글톤이고, 여기 쓰기는 트랜잭션
     * 롤백이 닿지 않는다. 수집 스텁이 만드는 행은 시드와 이름이 같아 후보풀에 중복이 쌓인다.
     *
     * 무서운 점은 발현 시점이다 — 테스트를 **추가하기만 해도** 실행 순서가 바뀌어 몇 달 잠복하던
     * 오염이 무관한 PR 에서 터진다(PR #241 실측).
     */
    @AfterEach
    fun cleanUpOwnRows() {
        cleanupJdbc.update("DELETE FROM poi WHERE source = 'MANUAL' AND source_ref IS NULL AND poi_id::text NOT LIKE 'e0000000-%'")
    }

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
