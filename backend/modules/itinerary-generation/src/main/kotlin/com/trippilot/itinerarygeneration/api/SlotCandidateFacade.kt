package com.trippilot.itinerarygeneration.api

import java.util.UUID

/**
 * 슬롯 교체 후보 조회(C8) — 공개 계약(R1, `..api..`).
 *
 * 왜 여기 있나: "이 자리에 대신 갈 만한 곳"을 고르는 규칙(일정에 이미 있는 곳 제외·closed-set 재확인·컨셉 필터·
 * 저장된 점수 풀 즉답)은 C8 것이고, 그 서비스는 `application` 이라 밖에서 못 본다. 도우미(U8)의 대체 후보
 * (FD §4 `SUGGEST_ALTERNATIVE`)가 REST `POST …/itinerary/slot-candidates` 와 **같은 서비스**를 타게 한다 —
 * 따로 조립하면 화면의 "다른 후보"와 도우미의 후보가 갈린다(BR-U3-23).
 */
interface SlotCandidateFacade {

    /**
     * [slotKey](`"{date}#{poiId}"`) 슬롯을 대신할 후보. 판정은 REST 와 같다 — 형식 오류·반경 초과는 `ValidationFailed`,
     * 없거나 타 계정·없는 슬롯은 `ResourceNotFound`, 확정 일정·생성 중 미도착 일자·같은 날 같은 장소 중복은
     * `ConflictDetected`, 후보를 낼 수 없으면 `UpstreamUnavailable`(후보는 지어내지 않는다, INV-1).
     *
     * 후보는 **제안일 뿐**이다 — 시각도 순서도 없다(INV-2). 고른 뒤의 길은 [ItineraryEditProposalFacade] 다.
     */
    fun propose(accountId: UUID, tripId: UUID, slotKey: String): SlotCandidatesView
}

/**
 * @property degraded AI 가 순위를 못 매겼다 — 집합은 정본 그대로지만 거리순이고 이유 문구가 템플릿이다.
 * @property emptyReason 후보가 0건인 이유(`NO_NEARBY`|`ALL_IN_ITINERARY`). 후보가 있으면 null.
 *   앞은 범위를 넓히면 통하고 뒤는 넓혀도 같다 — 안내가 정반대라 뭉개지 않는다.
 */
data class SlotCandidatesView(
    val candidates: List<SlotCandidateView>,
    val degraded: Boolean,
    val emptyReason: String?,
)

/**
 * @property distanceRange 교체 대상 자리에서 이 후보까지의 거리 표시 문자열. 소요시간은 없다(INV-3).
 * @property rationale 고를 만한 이유 — 시각·소요시간을 말하지 않는다(BR-U2-09).
 */
data class SlotCandidateView(val poiId: UUID, val distanceRange: String, val rationale: String)
