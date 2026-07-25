package com.trippilot.accommodationsearch.application

import com.trippilot.accommodationsearch.domain.AccommodationContentPort
import com.trippilot.accommodationsearch.domain.Money
import com.trippilot.accommodationsearch.domain.Stay
import com.trippilot.accommodationsearch.domain.StayPriceWriterPort
import org.springframework.stereotype.Service

/**
 * 최저가 스냅숏 갱신(LC-U1-2). 콘텐츠 전량을 훑어 '부터 가격'을 stay_price_snapshot 에 upsert.
 * 1차: 스텁 콘텐츠 기준 고정가 산출(실 벤더 가격 조회로 대체 예정).
 * 실운영: @Scheduled(일1회) + ShedLock 단일 실행(U0 자산). 현재는 수동/기동 시 1회.
 */
@Service
class PriceSnapshotBatch(
    private val content: AccommodationContentPort,
    private val writer: StayPriceWriterPort,
) {
    fun refresh() {
        content.search(null).stays.forEach { stay ->
            writer.upsert(stay.key(), stubPriceFor(stay))
        }
    }

    /** 스텁 가격: 8~14만원대 결정론적 산출(externalId 기반). 실 벤더 단계에서 대체. */
    private fun stubPriceFor(stay: Stay): Money =
        Money(80_000L + Math.floorMod(stay.externalId.hashCode().toLong(), 61L) * 1_000L)
}
