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
import io.kotest.property.Arb
import io.kotest.property.arbitrary.element
import io.kotest.property.arbitrary.filter
import io.kotest.property.arbitrary.list
import io.kotest.property.arbitrary.orNull
import io.kotest.property.arbitrary.string
import io.kotest.property.arbitrary.stringPattern
import io.kotest.property.checkAll
import java.time.Instant
import java.util.UUID

/**
 * 탐색 목록의 지역 코드 조회(TRIP-1808).
 *
 * 이름 조회는 동명이지역 전부를 잡는다 — 서울 중구 여행의 목록에 울산·대구 중구 장소가 섞인 것이 QA O2 다.
 * **고른 코드의 접두사인 장소만, 그리고 그런 장소는 전부** 나와야 한다. 앞쪽만 재면 늘 빈 목록을 주는 구현도 통과한다.
 *
 * 대역은 접두사를 도메인 쪽 식으로 비교한다. SQL 식과의 일치는 실 DB IT(PlaceApiIT) 몫이다.
 */
class PoiRegionCodeQueryPropertyTest : StringSpec({

    val now = Instant.parse("2026-11-06T00:00:00Z")

    fun poi(code: String?) = Poi.reconstitute(
        poiId = UUID.randomUUID(), nameKo = "장소", lat = 37.5, lng = 127.0, category = PoiCategory.명소,
        region = "중구", regionCode = code, openingHours = null, dataStatus = DataStatus.ACTIVE,
        source = PoiSource.MANUAL, savedCount = 0, createdAt = now, updatedAt = now,
    )

    fun svcWith(codes: List<String?>): Pair<PoiQueryService, List<Poi>> {
        val repo = InMemoryPoiRepository()
        val pois = codes.map { poi(it) }
        repo.saveAll(pois)
        return PoiQueryService(repo, RegionLookupService(FakeRegionCatalog)) to pois
    }

    val validCode = Arb.stringPattern("[0-9]{2}|[0-9]{5}")

    // 무작위 숫자만 쓰면 접두사가 거의 안 겹쳐 "전부 나온다"가 공허해진다 — 시드(시도 2자리)·동명 구·이웃 구를 섞는다.
    val storedCode = Arb.element("11", "11140", "11110", "26110", "27110", "31110", "48", "48820", "51", "51820").orNull(0.1)
    val queriedCode = Arb.element("11", "11140", "26110", "48820", "51820", "51", "99", "99999")

    "임의 코드로 조회한 결과는 그 접두사인 장소 전부다" {
        checkAll(Arb.list(storedCode, 0..30), queriedCode) { stored, code ->
            val (svc, pois) = svcWith(stored)

            val got = svc.search(region = null, category = null, regionCode = code).items

            got.map { it.poiId } shouldContainExactlyInAnyOrder
                pois.filter { it.regionCode?.startsWith(code) == true }.map { it.poiId }
        }
    }

    "형식이 맞는 어떤 코드든 결과에 다른 접두사가 섞이지 않는다" {
        checkAll(Arb.list(storedCode, 0..30), validCode) { stored, code ->
            val (svc, _) = svcWith(stored)

            svc.search(region = null, category = null, regionCode = code).items
                .all { it.regionCode?.startsWith(code) == true } shouldBe true
        }
    }

    "함께 온 이름은 무시한다 — 코드가 이긴다" {
        checkAll(Arb.list(storedCode, 0..30), queriedCode, Arb.element("중구", "서울", "없는지역", "")) { stored, code, name ->
            val (svc, _) = svcWith(stored)

            svc.search(region = name, category = null, regionCode = code).items.map { it.poiId } shouldBe
                svc.search(region = null, category = null, regionCode = code).items.map { it.poiId }
        }
    }

    // 지역 조건을 떨어뜨리면 전국이 나간다 — 화면은 그것을 "그 지역 장소"로 그린다.
    "2자리·5자리 숫자가 아니면 400 이다" {
        val notCode = Arb.string(0..8).filter { !Regex("[0-9]{2}|[0-9]{5}").matches(it) }
        val edges = listOf("", " ", "1", "111", "1114", "111400", "11,26", "%", "11%", "1114０", "１１")
        val (svc, _) = svcWith(listOf("11140"))

        edges.forEach { shouldThrow<ValidationFailed> { svc.search(region = null, category = null, regionCode = it) } }
        checkAll(notCode) { bad ->
            shouldThrow<ValidationFailed> { svc.search(region = "중구", category = null, regionCode = bad) }
        }
    }

    "코드 없이 이름만 오면 동명이지역 전부다 — 옛 앱 그대로" {
        val (svc, pois) = svcWith(listOf("26170", "27140", "26350"))

        // FakeRegionCatalog: 동구 = 부산 26170 · 대구 27140
        svc.search(region = "동구", category = null).items.map { it.poiId } shouldContainExactlyInAnyOrder
            pois.filter { it.regionCode != "26350" }.map { it.poiId }
    }
})
