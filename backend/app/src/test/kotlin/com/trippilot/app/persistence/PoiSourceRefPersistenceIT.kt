package com.trippilot.app.persistence

import com.trippilot.placedata.domain.DataStatus
import com.trippilot.placedata.domain.Poi
import com.trippilot.placedata.domain.PoiCategory
import com.trippilot.placedata.domain.PoiRepository
import com.trippilot.placedata.domain.PoiSource
import com.trippilot.testsupport.AbstractPostgresIntegrationTest
import io.kotest.assertions.throwables.shouldThrow
import io.kotest.matchers.maps.shouldContainKey
import io.kotest.matchers.shouldBe
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.dao.DataIntegrityViolationException
import java.time.Instant
import java.util.UUID

/**
 * poi.source_ref 실 DB 검증(V2.23).
 *
 * 여기서만 드러나는 것:
 * - **부분 유니크** `(source, source_ref)` — 앱이 멱등 판정을 놓쳐도 DB 가 막는다.
 *   수동 등록분(source_ref NULL)은 **여러 건이어야 한다** — 인메모리 페이크로는 이 조합을 재현하지 못한다.
 * - 출처가 다르면 같은 식별자라도 별개 — 식별자 체계는 벤더마다 독립이다.
 */
@SpringBootTest
class PoiSourceRefPersistenceIT : AbstractPostgresIntegrationTest() {

    @Autowired private lateinit var cleanupJdbc: JdbcTemplate

    /**
     * **넣은 것을 치운다.** Testcontainers 는 전 IT 가 공유하는 싱글톤이고, 여기 쓰기는 트랜잭션
     * 롤백이 닿지 않는다. 남기면 후보풀에 정체불명의 장소가 섞여 일정 생성 결과가 테스트 순서에 따라 달라진다.
     *
     * 무서운 점은 발현 시점이다 — 테스트를 **추가하기만 해도** 실행 순서가 바뀌어 몇 달 잠복하던
     * 오염이 무관한 PR 에서 터진다(PR #241 실측).
     */
    @AfterEach
    fun cleanUpOwnRows() {
        cleanupJdbc.update("DELETE FROM poi WHERE name_ko LIKE '테스트장소-%'")
    }

    @Autowired private lateinit var pois: PoiRepository

    private val now: Instant = Instant.parse("2026-08-18T03:00:00Z")

    private fun poi(source: PoiSource, ref: String?, name: String = "테스트장소-${UUID.randomUUID()}") =
        Poi.reconstitute(
            poiId = UUID.randomUUID(), nameKo = name, lat = 33.5, lng = 126.5,
            category = PoiCategory.자연, region = "제주", openingHours = null,
            dataStatus = DataStatus.ACTIVE, source = source, savedCount = 0,
            createdAt = now, updatedAt = now, sourceRef = ref,
        )

    @Test
    fun `같은 출처의 같은 식별자는 두 번 저장되지 않는다`() {
        pois.saveAll(listOf(poi(PoiSource.TOURAPI, "DUP-1")))

        shouldThrow<DataIntegrityViolationException> {
            pois.saveAll(listOf(poi(PoiSource.TOURAPI, "DUP-1")))
        }
    }

    // 수동 등록분은 외부 식별자가 없다. NULL 이 유일성에 걸리면 시드가 한 건밖에 못 들어간다.
    @Test
    fun `식별자 없는 행은 여러 건 허용된다`() {
        pois.saveAll(listOf(poi(PoiSource.MANUAL, null), poi(PoiSource.MANUAL, null)))

        // 예외 없이 통과하는 것 자체가 단언이다.
        // 덧: Postgres 는 일반 유니크에서도 NULL 을 서로 다르게 보므로 부분 절(WHERE)이 이걸 **만들어 내지는**
        // 않는다 — 부분 절은 의도를 인덱스에 적어 둔 것이고, 이 테스트가 막는 것은 훗날 누군가
        // `NULLS NOT DISTINCT`(PG15+)를 붙여 수동 등록분이 한 건만 남게 되는 회귀다.
        pois.findBySourceRefs(PoiSource.MANUAL, listOf("아무거나")) shouldBe emptyMap()
    }

    @Test
    fun `출처가 다르면 같은 식별자라도 공존한다`() {
        pois.saveAll(listOf(poi(PoiSource.TOURAPI, "SHARED-9"), poi(PoiSource.KAKAO_LOCAL, "SHARED-9")))

        pois.findBySourceRefs(PoiSource.TOURAPI, listOf("SHARED-9")) shouldContainKey "SHARED-9"
        pois.findBySourceRefs(PoiSource.KAKAO_LOCAL, listOf("SHARED-9")) shouldContainKey "SHARED-9"
    }

    // 조회가 상태로 좁혀지면 폐업 처리된 장소를 재수집이 새 행으로 다시 만든다.
    @Test
    fun `상태와 무관하게 찾는다 — 폐업분도 다시 만들지 않는다`() {
        val closed = Poi.reconstitute(
            poiId = UUID.randomUUID(), nameKo = "폐업한곳", lat = 33.5, lng = 126.5,
            category = PoiCategory.맛집, region = "제주", openingHours = null,
            dataStatus = DataStatus.CLOSED, source = PoiSource.TOURAPI, savedCount = 0,
            createdAt = now, updatedAt = now, sourceRef = "CLOSED-1",
        )
        pois.saveAll(listOf(closed))

        pois.findBySourceRefs(PoiSource.TOURAPI, listOf("CLOSED-1")) shouldContainKey "CLOSED-1"
    }
}
