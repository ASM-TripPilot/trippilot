package com.trippilot.placedata.application

import com.trippilot.placedata.FakeRegionCatalog
import io.kotest.matchers.collections.shouldBeEmpty
import com.trippilot.placedata.InMemoryPoiRepository
import com.trippilot.placedata.api.Area
import com.trippilot.placedata.domain.DataStatus
import com.trippilot.placedata.domain.Poi
import com.trippilot.placedata.domain.PoiCategory
import com.trippilot.placedata.domain.PoiSource
import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.collections.shouldContainExactlyInAnyOrder
import io.kotest.matchers.shouldBe
import java.time.Instant

/** RAG 후보풀 — 지역/반경·카테고리 resolve, ground(ACTIVE만). */
class CandidatePoolTest : StringSpec({

    val now = Instant.parse("2026-07-31T00:00:00Z")
    fun poi(
        name: String, lat: Double, lng: Double, cat: PoiCategory,
        status: DataStatus = DataStatus.ACTIVE,
        // 지역 필터는 **코드**로 돈다(TRIP-503) — 이름은 표시용이라 여기 값이 판정을 가르지 않는다.
        regionCode: String? = "26170",
    ): Poi =
        Poi.reconstitute(
            java.util.UUID.randomUUID(), name, lat, lng, cat, "동구", null, status, PoiSource.MANUAL, 0, now, now,
            regionCode = regionCode, // 기본값 인자라 **이름으로** 넘긴다 — 위치로 넣으면 openingHours 에 들어간다
        )

    fun poolOf(repo: InMemoryPoiRepository) =
        PlaceDataCandidatePool(repo, PoiQueryService(repo, RegionLookupService(FakeRegionCatalog)))

    "resolve 지역 — ACTIVE만, 카테고리 무필터" {
        val repo = InMemoryPoiRepository()
        val active = poi("자갈치", 35.096, 129.030, PoiCategory.맛집)
        repo.saveAll(listOf(active, poi("미확인", 35.1, 129.0, PoiCategory.명소, DataStatus.UNVERIFIED)))
        val pool = poolOf(repo)

        pool.resolve(Area.Region("동구"), emptySet()).map { it.nameKo } shouldBe listOf("자갈치")
    }

    "resolve 반경 — 반경 밖 배제·distanceM 채움" {
        val repo = InMemoryPoiRepository()
        val near = poi("자갈치", 35.0965, 129.0306, PoiCategory.맛집)     // 중심
        val far = poi("해운대", 35.1587, 129.1604, PoiCategory.자연)      // ~13km
        repo.saveAll(listOf(near, far))
        val pool = poolOf(repo)

        val got = pool.resolve(Area.Radius(35.0965, 129.0306, 3000.0), emptySet())
        got.map { it.nameKo } shouldBe listOf("자갈치")
        got.single().distanceM shouldBe 0.0 // 중심점과 동일 좌표
    }

    "resolve 카테고리 필터" {
        val repo = InMemoryPoiRepository()
        repo.saveAll(listOf(poi("자갈치", 35.096, 129.030, PoiCategory.맛집), poi("감천", 35.097, 129.010, PoiCategory.명소)))
        val pool = poolOf(repo)

        pool.resolve(Area.Region("동구"), setOf("맛집")).map { it.nameKo } shouldBe listOf("자갈치")
    }

    /**
     * **동명이지역은 전부 대상이다.** `동구` 는 부산(26170)·대구(27140)에 다 있어 하나를 고르면 거짓이다.
     * 이름 일치로 거르던 시절에는 두 도시가 섞여 나왔는데(실측 4개 도시 118건), 코드로 거르면
     * "그 이름을 가진 지역들"만 정확히 모인다.
     */
    "resolve 지역 — 동명이지역은 모두 모이고 남의 지역은 안 섞인다" {
        val repo = InMemoryPoiRepository()
        repo.saveAll(
            listOf(
                poi("부산동구", 35.1, 129.0, PoiCategory.명소, regionCode = "26170"),
                poi("대구동구", 35.9, 128.6, PoiCategory.명소, regionCode = "27140"),
                poi("양천구", 37.5, 126.8, PoiCategory.명소, regionCode = "11470"),
            ),
        )

        poolOf(repo).resolve(Area.Region("동구"), emptySet()).map { it.nameKo }
            .shouldContainExactlyInAnyOrder(listOf("부산동구", "대구동구"))
    }

    /** 시도를 고르면 그 안이 전부 잡힌다 — 코드 접두사라 성립한다(광역 조회가 8/149 로 비던 자리). */
    "resolve 지역 — 시도로 고르면 하위 시군구가 전부 잡힌다" {
        val repo = InMemoryPoiRepository()
        repo.saveAll(listOf(poi("부산동구", 35.1, 129.0, PoiCategory.명소, regionCode = "26170")))

        poolOf(repo).resolve(Area.Region("부산광역시"), emptySet()).map { it.nameKo } shouldBe listOf("부산동구")
    }

    /** 모르는 이름에 전국을 돌려주면 화면이 그것을 "그 지역 장소"로 표시한다 — 없다고 말하는 편이 맞다. */
    "resolve 지역 — 모르는 이름은 빈 결과다" {
        val repo = InMemoryPoiRepository()
        repo.saveAll(listOf(poi("부산동구", 35.1, 129.0, PoiCategory.명소)))

        poolOf(repo).resolve(Area.Region("Paris"), emptySet()).shouldBeEmpty()
    }

    "ground — ACTIVE만(미확인·없는 id 제외)" {
        val repo = InMemoryPoiRepository()
        val a = poi("자갈치", 35.096, 129.030, PoiCategory.맛집)
        val u = poi("미확인", 35.1, 129.0, PoiCategory.명소, DataStatus.UNVERIFIED)
        repo.saveAll(listOf(a, u))
        val pool = poolOf(repo)

        pool.ground(listOf(a.poiId, u.poiId, java.util.UUID.randomUUID())).map { it.poiId } shouldContainExactlyInAnyOrder listOf(a.poiId)
    }
})
