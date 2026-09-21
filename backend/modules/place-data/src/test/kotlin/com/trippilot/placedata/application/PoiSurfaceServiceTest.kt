package com.trippilot.placedata.application

import com.trippilot.placedata.InMemoryPoiRepository
import com.trippilot.placedata.domain.DataStatus
import com.trippilot.placedata.domain.Poi
import com.trippilot.placedata.domain.PoiCategory
import com.trippilot.placedata.domain.PoiSnapshot
import com.trippilot.placedata.domain.PoiSnapshotRepository
import com.trippilot.placedata.domain.PoiSource
import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.shouldBe
import io.kotest.matchers.shouldNotBe
import java.time.Clock
import java.time.Instant
import java.time.ZoneOffset
import java.util.UUID

/**
 * 표면 조회가 **두 어휘를 함께** 내보내는지(TRIP-883 후속).
 *
 * ## 왜 이 스펙이 필요했나
 *
 * 카테고리를 경계 너머로 보내는 배선을 깔고 역검증을 돌렸더니, `boundaryCode` 를 한글 `name` 으로
 * 되돌려도 **아무 스펙도 깨지지 않았다.** 위쪽 테스트들이 전부 `PoiSurfaceView` 를 손으로 만들어
 * 써서, 정작 **한글 ↔ 코드 변환이 일어나는 자리가 무검사**였다. 값이 흐르는 것만 재고 있었다.
 *
 * 어긋났을 때의 증상이 조용하다는 것이 이 자리를 특히 위험하게 만든다 — 상대 사전(`_CATEGORY_LABELS`)
 * 은 코드를 키로 쓰므로 한글이 가면 **사전에 없어 그냥 무시되고**, 422 도 로그도 없이 카테고리만
 * 사라진다. 터지면 차라리 낫다.
 */
private class NoSnapshots : PoiSnapshotRepository {
    val stored = mutableListOf<PoiSnapshot>()
    override fun save(snapshot: PoiSnapshot) = snapshot.also { stored += it }
    override fun findById(poiSnapshotId: UUID) = stored.firstOrNull { it.poiSnapshotId == poiSnapshotId }
    override fun findByIds(poiSnapshotIds: Collection<UUID>) = stored.filter { it.poiSnapshotId in poiSnapshotIds }
}

class PoiSurfaceServiceTest : StringSpec({

    val clock = Clock.fixed(Instant.parse("2026-07-31T00:00:00Z"), ZoneOffset.UTC)

    fun poi(category: PoiCategory) = Poi.reconstitute(
        UUID.randomUUID(), "자갈치시장", 35.096, 129.030, category, "부산", null,
        DataStatus.ACTIVE, PoiSource.MANUAL, 0, clock.instant(), clock.instant(),
    )

    fun service(vararg pois: Poi): Pair<PoiSurfaceService, List<Poi>> {
        val repo = InMemoryPoiRepository()
        pois.forEach { repo.stored.add(it) }
        return PoiSurfaceService(repo, NoSnapshots()) to pois.toList()
    }

    /**
     * 화면은 한글을 쓰고 AI 경계는 코드를 쓴다. **둘 다 실어야** 한쪽을 위해 다른 쪽을 포기하지 않는다.
     */
    "한글 정본과 경계 코드를 함께 내보낸다" {
        val (svc, stored) = service(poi(PoiCategory.맛집))

        val view = svc.findSurfaces(stored.map { it.poiId }).values.single()

        view.category shouldBe "맛집"
        view.categoryCode shouldBe "FOOD"
    }

    /**
     * **전 값을 덮는지** 본다. 한 값만 변환표에서 빠져도 그 카테고리의 장소만 조용히 이름만 렌더되고,
     * 어느 카테고리가 새는지는 문구를 눈으로 봐야 알 수 있다.
     */
    "모든 카테고리가 코드로 바뀐다 — 한글이 하나도 새지 않는다" {
        val (svc, stored) = service(*PoiCategory.entries.map { poi(it) }.toTypedArray())

        val codes = svc.findSurfaces(stored.map { it.poiId }).values.map { it.categoryCode }

        codes.size shouldBe PoiCategory.entries.size
        // 한글 음절이 섞이면 그 값은 상대 사전에 없다 — 값 자체를 막는다.
        codes.none { code -> code.any { it.code in 0xAC00..0xD7A3 } } shouldBe true
        // 코드가 한글 정본과 같으면 변환이 안 된 것이다.
        codes.toSet() shouldNotBe PoiCategory.entries.map { it.name }.toSet()
    }
})
