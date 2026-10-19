package com.trippilot.accommodationsearch.application

import com.trippilot.accommodationsearch.domain.AccommodationContentPort
import com.trippilot.accommodationsearch.domain.ContentResult
import com.trippilot.accommodationsearch.domain.CuratedStay
import com.trippilot.accommodationsearch.domain.CuratedStayPort
import com.trippilot.accommodationsearch.domain.Stay
import com.trippilot.accommodationsearch.domain.StayKey
import com.trippilot.core.error.ValidationFailed
import io.kotest.assertions.throwables.shouldThrow
import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.shouldBe

private class LookupContent(private val stays: List<Stay>) : AccommodationContentPort {
    override fun search(region: String?) = ContentResult(stays, degraded = false)
    override fun findOne(key: StayKey) = stays.firstOrNull { it.key() == key }
}

private class LookupCurated(private val stays: List<CuratedStay>) : CuratedStayPort {
    override fun byCity(city: String) = stays.filter { it.city == city }
    override fun findByHotelId(hotelId: String) = stays.firstOrNull { it.tripcomHotelId == hotelId }
}

/**
 * 이름 조회 퍼사드(R1) — affiliate-link 의 아웃바운드가 쓴다.
 * 상세와 같은 규약을 지킨다: 형식 오류 400 · 부재 null(호출측이 404 로 올린다).
 */
class StayLookupServiceTest : StringSpec({

    val jeju = Stay("STUB", "jeju-001", "제주 오션 리조트", 33.246, 126.562, "제주", setOf("주차"), "리조트")
    val venue = CuratedStay("서울", 1, "4645968", "호텔 베뉴지", null, "https://ak-d.tripcdn.com/images/x.jpg")
    // 정본에 같은 식별자를 심어 둔다 — 출처를 안 보고 정본부터 찾으면 이 이름이 새어 나온다.
    val decoy = Stay("LOCALDATA", "4645968", "엉뚱한 정본 숙소", 37.5, 127.0, "종로구", emptySet(), "호텔")
    val svc = StayLookupService(LookupContent(listOf(jeju, decoy)), LookupCurated(listOf(venue)))

    "존재하는 숙소의 이름을 돌려준다" {
        svc.findName("STUB:jeju-001") shouldBe "제주 오션 리조트"
    }

    "없는 숙소는 null — 지어내지 않는다" {
        svc.findName("STUB:no-such") shouldBe null
    }

    "형식 오류는 400 — 부재(null)와 접지 않는다(상세와 같은 의미론)" {
        shouldThrow<ValidationFailed> { svc.findName("콜론없음") }
    }

    "트립닷컴 큐레이션 출처는 큐레이션 목록에서 찾는다" {
        svc.findName("TRIPCOM:4645968") shouldBe "호텔 베뉴지"
    }

    "큐레이션에 없는 트립닷컴 호텔은 null — 정본으로 새지 않는다" {
        svc.findName("TRIPCOM:999") shouldBe null
    }
})
