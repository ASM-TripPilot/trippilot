package com.trippilot.placedata.application

import com.trippilot.core.error.ValidationFailed
import com.trippilot.placedata.FakeRegionCatalog
import com.trippilot.placedata.InMemoryPoiRepository
import com.trippilot.placedata.domain.DataStatus
import com.trippilot.placedata.domain.Poi
import com.trippilot.placedata.domain.PoiCategory
import com.trippilot.placedata.domain.PoiSource
import io.kotest.assertions.throwables.shouldThrow
import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.collections.shouldContainExactlyInAnyOrder
import io.kotest.matchers.shouldBe
import io.kotest.matchers.shouldNotBe
import io.kotest.property.Arb
import io.kotest.property.arbitrary.int
import io.kotest.property.arbitrary.list
import io.kotest.property.arbitrary.string
import io.kotest.property.arbitrary.stringPattern
import io.kotest.property.checkAll
import java.time.Instant
import java.util.UUID

/**
 * 탐색 목록 무작위 정렬(TRIP-1570 · TRIP-1563 선행).
 *
 * 화면은 한 진입 동안 같은 seed 로 장을 이어 받는다. 정렬 키가 결정적이지 않으면 다음 장에서
 * 앞 장의 장소가 다시 나오거나 영영 안 나온다 — 사용자에게는 "목록이 이상하다"로만 보인다.
 * 그래서 **어느 장 크기로 이어 받아도 합집합 = 전체, 중복 0** 을 성질로 잠근다.
 *
 * 이 대역(InMemory)은 정렬 키를 도메인 식으로 비교한다. 무작위 키는 소문자 hex 고정 길이라
 * 콜레이션과 코드포인트 순서가 갈리지 않지만, SQL 식과의 일치 자체는 실 DB IT(PlacesSearchOrderIT) 몫이다.
 */
class PoiRandomOrderPropertyTest : StringSpec({

    val now = Instant.parse("2026-10-22T00:00:00Z")

    fun poi(name: String) = Poi.reconstitute(
        poiId = UUID.randomUUID(), nameKo = name, lat = 37.5, lng = 127.0, category = PoiCategory.명소,
        region = "서울", regionCode = "11110", openingHours = null, dataStatus = DataStatus.ACTIVE,
        source = PoiSource.MANUAL, savedCount = 0, createdAt = now, updatedAt = now,
    )

    fun svcWith(names: List<String>): Pair<PoiQueryService, List<Poi>> {
        val repo = InMemoryPoiRepository()
        val pois = names.map { poi(it) }
        repo.saveAll(pois)
        return PoiQueryService(repo, RegionLookupService(FakeRegionCatalog)) to pois
    }

    fun PoiQueryService.drain(seed: String, size: Int, q: String? = null): List<UUID> {
        val out = mutableListOf<UUID>()
        var cursor: String? = null
        var guard = 0
        do {
            val page = search(region = null, category = null, query = q, cursor = cursor, limit = size, order = "random", seed = seed)
            out += page.items.map { it.poiId }
            cursor = page.nextCursor
            guard++
        } while (cursor != null && guard < 1_000)
        return out
    }

    val seeds = Arb.stringPattern("[A-Za-z0-9_-]{1,32}")

    "같은 seed 로 어느 장 크기로 이어 받아도 중복·누락이 없다" {
        checkAll(Arb.list(Arb.string(1..6), 0..40), seeds, Arb.int(1..7)) { names, seed, size ->
            val (svc, pois) = svcWith(names)

            val got = svc.drain(seed, size)

            got.size shouldBe pois.size // 중복 없음(합집합 크기와 같다)
            got shouldContainExactlyInAnyOrder pois.map { it.poiId } // 누락 없음
        }
    }

    "같은 seed 면 장 크기와 무관하게 같은 순서다" {
        checkAll(Arb.list(Arb.string(1..6), 0..30), seeds, Arb.int(1..7)) { names, seed, size ->
            val (svc, _) = svcWith(names)

            svc.drain(seed, size) shouldBe svc.drain(seed, 200)
        }
    }

    "seed 가 다르면 순서가 다르다 — 이름순이 아니다" {
        val names = (1..20).map { "장소%02d".format(it) }
        val (svc, pois) = svcWith(names)
        val byName = pois.sortedBy { it.nameKo }.map { it.poiId }

        val a = svc.drain("seed-a", 200)
        val b = svc.drain("seed-b", 200)

        a shouldNotBe b
        a shouldNotBe byName
        b shouldNotBe byName
    }

    "검색어가 있으면 관련도 축은 그대로 첫 축이다 — 정확 일치가 먼저 온다" {
        val (svc, _) = svcWith(listOf("명동교자", "광명동굴", "명동", "명동성당", "남명동"))

        val first = svc.search(region = null, category = null, query = "명동", order = "random", seed = "x").items.first()

        first.nameKo shouldBe "명동"
    }

    "order 를 주지 않으면 기존 이름순 그대로다" {
        val (svc, _) = svcWith(listOf("다", "가", "나"))

        svc.search(region = null, category = null).items.map { it.nameKo } shouldBe listOf("가", "나", "다")
    }

    "order=random 인데 seed 가 없으면 거절한다 — 조용히 이름순으로 떨어뜨리지 않는다" {
        val (svc, _) = svcWith(listOf("가"))
        shouldThrow<ValidationFailed> { svc.search(region = null, category = null, order = "random", seed = null) }
        shouldThrow<ValidationFailed> { svc.search(region = null, category = null, order = "random", seed = "  ") }
    }

    "seed 형식이 깨지면 거절한다 — 허용 문자 밖·64자 초과" {
        val (svc, _) = svcWith(listOf("가"))
        shouldThrow<ValidationFailed> { svc.search(region = null, category = null, order = "random", seed = "a\u0000b") }
        shouldThrow<ValidationFailed> { svc.search(region = null, category = null, order = "random", seed = "a".repeat(65)) }
    }

    "모르는 order 값은 거절한다" {
        val (svc, _) = svcWith(listOf("가"))
        shouldThrow<ValidationFailed> { svc.search(region = null, category = null, order = "shuffle") }
    }
})
