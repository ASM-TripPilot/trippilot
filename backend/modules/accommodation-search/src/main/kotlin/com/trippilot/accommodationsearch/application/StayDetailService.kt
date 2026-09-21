package com.trippilot.accommodationsearch.application

import com.trippilot.accommodationsearch.domain.AccommodationContentPort
import com.trippilot.accommodationsearch.domain.StayKey
import com.trippilot.accommodationsearch.domain.StayPriceQueryPort
import com.trippilot.accommodationsearch.domain.StayResult
import com.trippilot.core.error.FieldError
import com.trippilot.core.error.ResourceNotFound
import com.trippilot.core.error.ValidationFailed
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
        val key = parseKey(stayId)
        val stay = content.findOne(key) ?: throw ResourceNotFound()
        // 가격은 **없을 수 있다**(BR-U1-14 "가격 미확인") — 없다고 상세를 막지 않는다.
        // 정본 12,782곳에는 스냅숏이 한 건도 없다(숙소콘텐츠-수집-설계.md §1).
        return StayResult(stay, prices.lowestPrices(listOf(key))[key])
    }

    /**
     * `"{source}:{externalId}"` → [StayKey].
     *
     * **합성 문자열인 이유**: `stay` 의 PK 가 복합키(`external_source`,`external_id`)라 경로에
     * 그대로 못 넣는다. 대리 UUID 를 새로 주는 안은 기각했다 — 시드를 재생성할 때마다 값이
     * 흔들리고, 목록 응답이 이미 두 필드를 따로 실어 클라이언트가 조립만 하면 된다.
     *
     * **첫 콜론으로만 가른다.** 출처 코드에는 콜론이 없고(`LOCALDATA`·`STUB`), 식별자 쪽에
     * 콜론이 섞이더라도 뒤쪽은 통째로 식별자가 되는 것이 맞다.
     */
    private fun parseKey(stayId: String): StayKey {
        val source = stayId.substringBefore(':', missingDelimiterValue = "")
        val externalId = stayId.substringAfter(':', missingDelimiterValue = "")
        if (source.isBlank() || externalId.isBlank()) {
            // 400 으로 올린다 — 404 로 접으면 "형식이 틀렸다"와 "그런 숙소가 없다"가 같은 응답이
            // 되어, 클라이언트가 조립을 잘못하고 있어도 영영 모른다.
            throw ValidationFailed(
                listOf(FieldError("stayId", "숙소 식별자는 \"{출처}:{식별자}\" 형식입니다.")),
            )
        }
        return StayKey(source, externalId)
    }
}
