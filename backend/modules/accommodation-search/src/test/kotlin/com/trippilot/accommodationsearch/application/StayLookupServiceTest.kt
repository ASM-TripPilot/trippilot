package com.trippilot.accommodationsearch.application

import com.trippilot.accommodationsearch.domain.AccommodationContentPort
import com.trippilot.accommodationsearch.domain.ContentResult
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

/**
 * 이름 조회 퍼사드(R1) — affiliate-link 의 아웃바운드가 쓴다.
 * 상세와 같은 규약을 지킨다: 형식 오류 400 · 부재 null(호출측이 404 로 올린다).
 */
class StayLookupServiceTest : StringSpec({

    val jeju = Stay("STUB", "jeju-001", "제주 오션 리조트", 33.246, 126.562, "제주", setOf("주차"), "리조트")
    val svc = StayLookupService(LookupContent(listOf(jeju)))

    "존재하는 숙소의 이름을 돌려준다" {
        svc.findName("STUB:jeju-001") shouldBe "제주 오션 리조트"
    }

    "없는 숙소는 null — 지어내지 않는다" {
        svc.findName("STUB:no-such") shouldBe null
    }

    "형식 오류는 400 — 부재(null)와 접지 않는다(상세와 같은 의미론)" {
        shouldThrow<ValidationFailed> { svc.findName("콜론없음") }
    }
})
