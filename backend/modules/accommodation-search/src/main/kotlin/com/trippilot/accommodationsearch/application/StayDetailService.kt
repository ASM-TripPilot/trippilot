package com.trippilot.accommodationsearch.application

import com.trippilot.accommodationsearch.domain.AccommodationContentPort
import com.trippilot.accommodationsearch.domain.StayKey
import com.trippilot.accommodationsearch.domain.StayPriceQueryPort
import com.trippilot.accommodationsearch.domain.StayResult
import com.trippilot.core.error.ResourceNotFound
import org.springframework.stereotype.Service

/**
 * 숙소 상세(US-STAY-03 · BR-U1-18) — `GET /api/v1/stays/{stayId}`.
 *
 * ## 무엇을 담지 않는가
 *
 * **리뷰·평점을 앱 안에 두지 않는다**(US-STAY-03 — 외부 OTA 위임). 정적 콘텐츠와 최저가
 * 스냅숏만 담고, **정확 1박가는 여기 없다**(INV-U1-05 — 그쪽은 `LivePricePort` 몫이고
 * 캐싱 금지라 표시 시점에 따로 부른다). 소요시간도 없다(INV-3).
 *
 * ## 없으면 404 다
 *
 * 빈 상세를 200 으로 주면 화면이 "정보가 없는 숙소"를 그리고, 사용자는 그것이 우리 오류인지
 * 그 숙소가 원래 그런 건지 구분할 수 없다. 없는 것은 없다고 말한다.
 */
@Service
class StayDetailService(
    private val content: AccommodationContentPort,
    private val prices: StayPriceQueryPort,
) {
    fun detail(stayId: String): StayResult {
        // 형식 오류는 400(ValidationFailed), 없는 숙소는 404 — 규약은 StayKey.parse 소유.
        val key = StayKey.parse(stayId)
        val stay = content.findOne(key) ?: throw ResourceNotFound()
        // 가격은 **없을 수 있다**(BR-U1-14 "가격 미확인") — 없다고 상세를 막지 않는다.
        // 정본 12,782곳에는 스냅숏이 한 건도 없다(숙소콘텐츠-수집-설계.md §1).
        return StayResult(stay, prices.lowestPrices(listOf(key))[key])
    }
}
