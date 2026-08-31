package com.trippilot.itinerarygeneration.adapter.out.external

import com.trippilot.itinerarygeneration.application.SlotKey
import com.trippilot.placedata.api.Area
import com.trippilot.placedata.api.CandidatePoolPort
import com.trippilot.itinerarygeneration.domain.FreshnessMeta
import com.trippilot.itinerarygeneration.domain.SlotCandidate
import com.trippilot.itinerarygeneration.domain.SlotCandidatesInput
import com.trippilot.itinerarygeneration.domain.SlotCandidatesEmptyReason
import com.trippilot.itinerarygeneration.domain.SlotCandidatesOutput
import org.springframework.stereotype.Component
import java.time.Clock
import java.util.Locale
import java.util.UUID

/**
 * 슬롯 교체 후보를 **우리 후보풀에서** 만든다 — AI 없이(DEC-U3-5 폴백, RESILIENCY-10 예외).
 *
 * **후보 집합의 주인은 원래 C7 이다.** 닫힌 후보 풀(INV-1)은 place-data 소유이고, AI 가 더하는 것은
 * **순위와 이유**지 집합이 아니다. 그래서 AI 경로가 없어도 "무엇이 후보인가"는 우리가 답할 수 있다.
 *
 * 여기서 못 하는 것을 분명히 적어 둔다 — 나중에 이 자리가 임시였다는 사실이 잊히지 않도록.
 * - 정렬이 **거리순**이다. 취향 반영 순위가 아니다
 * - 근거 문구가 템플릿이다(`"주변 카페"`)
 * - `neighborSlotKeys`(앞뒤 슬롯과의 동선 트레이드오프)를 **보지 않는다**
 *
 * 그래서 결과에 [FreshnessMeta.degraded] 를 세워 내보낸다. 화면이 "AI 추천 준비 중, 거리순" 을
 * 말할 수 있어야 사용자가 오해하지 않고, 이 폴백이 조용히 영구화되지도 않는다(INV-4).
 */
@Component
class LocalSlotCandidateSource(
    private val candidatePool: CandidatePoolPort,
    private val clock: Clock,
) {

    /**
     * @param degraded AI 순위가 아님을 결과에 실을지. 실 AI 경로가 없어 이걸로 대신할 때 true.
     */
    fun propose(input: SlotCandidatesInput, degraded: Boolean): SlotCandidatesOutput {
        val excluded = input.excludePoiIds.toSet()
        // 교체 대상 자신은 언제나 반경 0m 에 있다 — "주변에 뭔가 있다"의 근거로 삼으면 안 된다.
        val self = SlotKey.parse(input.slotKey)?.second

        // 0건이면 반경을 한 번 넓혀 다시 본다 — h15 "반경 넓힘"을 서버가 대신한다.
        // 실제 사용한 반경을 그대로 돌려줘야 화면이 "3km 안에는 없어 12km 로 넓혔어요" 를 말할 수 있다.
        var radius = input.radiusM ?: DEFAULT_RADIUS_M
        var nearby = search(input, radius, self)
        var found = nearby.filterNot { it.poiId in excluded }
        if (found.isEmpty() && radius < WIDENED_RADIUS_M) {
            radius = WIDENED_RADIUS_M
            nearby = search(input, radius, self)
            found = nearby.filterNot { it.poiId in excluded }
        }

        return SlotCandidatesOutput(
            candidates = found.take(MAX_CANDIDATES).map {
                SlotCandidate(
                    poiId = it.poiId,
                    // 거리만 — 소요시간은 어떤 이유로도 내보내지 않는다(INV-3).
                    distanceRange = it.distanceM?.let { m -> "약 ${"%.1f".format(Locale.ROOT, m / 1000)}km" }
                        ?: "거리 미확인",
                    // 시각·소요시간을 언급하지 않는다(BR-U2-09).
                    rationale = input.concept?.let { c -> "$c 컨셉에 맞는 ${it.category}" } ?: "주변 ${it.category}",
                )
            },
            radiusMUsed = radius,
            freshness = FreshnessMeta(clock.instant(), degraded = degraded),
            // 0건의 **이유**를 가른다. 넓힌 반경 안이 비었으면 넓히기가 통하고(NO_NEARBY),
            // 있는데 전부 일정에 들어 있으면 넓혀도 같은 결과다(ALL_IN_ITINERARY).
            // 뭉뚱그리면 사용자가 반경만 계속 넓히며 헛돈다.
            emptyReason = when {
                found.isNotEmpty() -> null
                nearby.isEmpty() -> SlotCandidatesEmptyReason.NO_NEARBY
                else -> SlotCandidatesEmptyReason.ALL_IN_ITINERARY
            },
        )
    }

    /** 반경 안의 후보(자기 자신 제외). 제외 목록은 여기서 적용하지 않는다 — 0건 사유를 가르려면 둘을 나눠 봐야 한다. */
    private fun search(input: SlotCandidatesInput, radiusM: Int, self: UUID?) =
        candidatePool.resolve(Area.Radius(input.centerLat, input.centerLng, radiusM.toDouble()), emptySet())
            .filterNot { it.poiId == self }
            .sortedBy { it.distanceM ?: Double.MAX_VALUE }

    private companion object {
        private const val DEFAULT_RADIUS_M = 3_000
        private const val WIDENED_RADIUS_M = 12_000
        private const val MAX_CANDIDATES = 5
    }
}
