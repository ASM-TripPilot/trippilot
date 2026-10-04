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

    private fun poi(
        source: PoiSource, ref: String?, name: String = "테스트장소-${UUID.randomUUID()}",
        status: DataStatus = DataStatus.ACTIVE,
    ) =
        Poi.reconstitute(
            poiId = UUID.randomUUID(), nameKo = name, lat = 33.5, lng = 126.5,
            category = PoiCategory.자연, region = "제주", openingHours = null,
            dataStatus = status, source = source, savedCount = 0,
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

    /**
     * 앱 enum 과 DB CHECK(`poi_source_check`)는 **같은 값 집합**이어야 한다(V2.61 · TRIP-1224 LOCALDATA).
     * enum 만 늘리면 저장이 CHECK 위반으로 죽고, CHECK 만 늘리면 읽기(`PoiSource.valueOf`)가 죽는다 —
     * 인메모리 페이크로는 어느 쪽도 안 보인다. 값마다 한 행씩 실제로 넣고 다시 읽는다.
     */
    @Test
    fun `모든 출처 값이 DB CHECK 를 통과하고 다시 읽힌다`() {
        pois.saveAll(PoiSource.entries.map { poi(it, "ALL-SOURCES-${it.name}") })

        PoiSource.entries.forEach {
            pois.findBySourceRefs(it, listOf("ALL-SOURCES-${it.name}")) shouldContainKey "ALL-SOURCES-${it.name}"
        }
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

    /**
     * 미포함 정리(TRIP-1227)의 대조 대상은 **같은 출처 · ACTIVE · 식별자 있음**뿐이다. 하나라도 새면 그 행은
     * 문서에 없다는 이유로 닫힌다 — 다른 출처의 멀쩡한 가게나 시드가 후보에서 사라진다.
     * 공유 컨테이너라 같은 출처의 남의 행이 있을 수 있어 같음이 아니라 포함·불포함으로 묻는다.
     */
    @Test
    fun `미포함 정리 대조는 같은 출처의 ACTIVE 이고 식별자 있는 행만 읽는다`() {
        val active = poi(PoiSource.TOURAPI, "CM-P-1")
        pois.saveAll(
            listOf(
                active,
                poi(PoiSource.TOURAPI, "CM-P-2", status = DataStatus.CLOSED),
                poi(PoiSource.TOURAPI, "CM-P-3", status = DataStatus.UNVERIFIED),
                poi(PoiSource.KAKAO_LOCAL, "CM-P-4"),
            ),
        )

        val refs = pois.findActiveSourceRefs(PoiSource.TOURAPI)

        refs["CM-P-1"] shouldBe active.poiId
        refs.keys.none { it in setOf("CM-P-2", "CM-P-3", "CM-P-4") } shouldBe true
    }

    /**
     * 실물이 포트 계약("지금 ACTIVE 인 것만 · 바뀐 수")을 지키는가 — 서비스는 대조 결과만 넘기지만, 대조와 쓰기
     * 사이에 상태가 바뀌어도 닫힌 행의 시각을 다시 덮지 않아야 언제 닫혔는지가 남는다.
     * 목록을 묶음(1,000) 너머까지 늘리고 진짜 대상을 **맨 뒤**에 둔다 — 묶음 하나만 보내는 실수를 잡는다.
     */
    @Test
    fun `닫기는 지금 ACTIVE 인 행만 바꾸고 바뀐 수를 센다 — 묶음 너머의 대상까지`() {
        val a = poi(PoiSource.TOURAPI, "CM-C-1")
        val b = poi(PoiSource.TOURAPI, "CM-C-2", status = DataStatus.CLOSED)
        val c = poi(PoiSource.TOURAPI, "CM-C-3", status = DataStatus.UNVERIFIED)
        pois.saveAll(listOf(a, b, c))
        val later = Instant.parse("2026-10-04T03:00:00Z")

        val changed = pois.closeActive(List(1_500) { UUID.randomUUID() } + listOf(a.poiId, b.poiId, c.poiId), later)

        changed shouldBe 1
        val after = pois.findByIds(listOf(a.poiId, b.poiId, c.poiId)).associateBy { it.poiId }
        after.getValue(a.poiId).dataStatus shouldBe DataStatus.CLOSED
        after.getValue(a.poiId).updatedAt shouldBe later
        after.getValue(b.poiId).updatedAt shouldBe now   // 이미 닫힌 행은 시각도 그대로
        after.getValue(c.poiId).dataStatus shouldBe DataStatus.UNVERIFIED
    }
}
