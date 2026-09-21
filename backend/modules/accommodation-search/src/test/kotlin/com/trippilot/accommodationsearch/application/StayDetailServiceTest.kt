package com.trippilot.accommodationsearch.application

import com.trippilot.accommodationsearch.domain.AccommodationContentPort
import com.trippilot.accommodationsearch.domain.ContentResult
import com.trippilot.accommodationsearch.domain.Money
import com.trippilot.accommodationsearch.domain.Stay
import com.trippilot.accommodationsearch.domain.StayKey
import com.trippilot.accommodationsearch.domain.StayPriceQueryPort
import com.trippilot.core.error.ResourceNotFound
import com.trippilot.core.error.ValidationFailed
import io.kotest.assertions.throwables.shouldThrow
import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.shouldBe

private class DetailContent(private val stays: List<Stay>) : AccommodationContentPort {
    /** 상세는 [findOne] 만 쓴다 — 목록으로 내려가면 정본 전량을 읽게 된다(그 회귀를 아래 스펙이 막는다). */
    var searchCalls = 0
    override fun search(region: String?): ContentResult {
        searchCalls++
        return ContentResult(stays, degraded = false)
    }
    override fun findOne(key: StayKey) = stays.firstOrNull { it.key() == key }
}

private class DetailPrices(private val map: Map<StayKey, Money> = emptyMap()) : StayPriceQueryPort {
    var askedFor: List<StayKey> = emptyList()
    override fun lowestPrices(keys: List<StayKey>): Map<StayKey, Money> {
        askedFor = keys
        return map.filterKeys { it in keys.toSet() }
    }
}

/**
 * 숙소 상세(US-STAY-03 · BR-U1-18).
 *
 * **이 스펙이 지키는 것은 셋이다.**
 *
 * 하나, **없으면 없다고 말한다.** 빈 상세를 200 으로 주면 화면이 "정보가 없는 숙소"를 그리고,
 * 사용자는 그것이 우리 오류인지 그 숙소가 원래 그런 건지 구분할 수 없다.
 *
 * 둘, **형식 오류와 부재를 같은 응답으로 접지 않는다.** 둘 다 404 로 접으면 클라이언트가
 * 식별자 조립을 잘못하고 있어도 영영 모른다.
 *
 * 셋, **가격이 없어도 상세는 열린다**(BR-U1-14). 정본 12,782곳에는 스냅숏이 한 건도 없어
 * (`숙소콘텐츠-수집-설계.md` §1) 이 경로가 사실상 기본값이다 — 여기서 막으면 상세가 통째로 죽는다.
 */
class StayDetailServiceTest : StringSpec({

    val jeju = Stay("STUB", "jeju-001", "제주 오션 리조트", 33.246, 126.562, "제주", setOf("주차", "조식"), "리조트")
    fun svc(stays: List<Stay> = listOf(jeju), prices: DetailPrices = DetailPrices()) =
        StayDetailService(DetailContent(stays), prices) to prices

    "존재하는 숙소를 돌려준다" {
        val (s, _) = svc()

        val r = s.detail("STUB:jeju-001")

        r.stay.name shouldBe "제주 오션 리조트"
        r.stay.stayType shouldBe "리조트"
    }

    "최저가 스냅숏이 있으면 함께 실린다" {
        val (s, _) = svc(prices = DetailPrices(mapOf(StayKey("STUB", "jeju-001") to Money(220_000))))

        s.detail("STUB:jeju-001").lowestPrice?.amount shouldBe 220_000
    }

    /**
     * **가격 부재는 상세를 막는 사유가 아니다**(BR-U1-14). 정본 전량이 이 경로를 탄다 —
     * 여기서 던지면 `STAY_CONTENT_MODE=db` 로 켜는 순간 상세가 통째로 죽는다.
     */
    "가격이 없어도 상세는 열린다 — 가격만 null 이다" {
        val (s, _) = svc()

        s.detail("STUB:jeju-001").lowestPrice shouldBe null
    }

    "없는 숙소는 404 로 올린다 — 빈 상세를 지어내지 않는다" {
        val (s, _) = svc()

        shouldThrow<ResourceNotFound> { s.detail("STUB:없는곳") }
    }

    /** 출처만 다르면 다른 숙소다 — 식별자가 같아도 붙이지 않는다(복합 PK 의 뜻). */
    "출처가 다르면 못 찾는다" {
        val (s, _) = svc()

        shouldThrow<ResourceNotFound> { s.detail("LOCALDATA:jeju-001") }
    }

    /**
     * **형식 오류는 400 이다.** 404 로 접으면 "조립을 잘못했다"와 "그런 숙소가 없다"가 같은
     * 응답이 되어, 클라이언트가 계속 틀린 식별자를 보내도 아무도 모른다.
     */
    "식별자 형식이 틀리면 400 이다 — 404 로 접지 않는다" {
        val (s, _) = svc()

        listOf("콜론없음", ":식별자만", "출처만:", ":", "").forEach { bad ->
            shouldThrow<ValidationFailed> { s.detail(bad) }
        }
    }

    /**
     * **목록으로 내려가 걸러내지 않는다.** 그러면 상세 한 번에 정본 12,782곳을 읽는다 —
     * 지역 미선택 조회가 상한에 걸리는 것과 같은 문제이고, 증상이 느려짐뿐이라 안 드러난다.
     */
    "상세는 전량 조회를 하지 않는다" {
        val content = DetailContent(listOf(jeju))

        StayDetailService(content, DetailPrices()).detail("STUB:jeju-001")

        content.searchCalls shouldBe 0
    }

    /** 가격도 한 건만 묻는다 — 키 전량을 넘기면 스냅숏 테이블을 통째로 훑는 구현이 그대로 산다. */
    "가격은 그 숙소 하나만 묻는다" {
        val (s, prices) = svc()

        s.detail("STUB:jeju-001")

        prices.askedFor shouldBe listOf(StayKey("STUB", "jeju-001"))
    }
})
