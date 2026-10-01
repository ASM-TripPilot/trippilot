package com.trippilot.itinerarygeneration.domain

import java.util.UUID

/**
 * 거절 이력 저장소 (TRIP-964) — 사용자가 밀어낸 POI 를 여행 단위로 누적한다.
 *
 * ## 무엇이 거절인가 — 두 종류, 신호 강도가 다르다
 *
 * - [RejectedPoi.Kind.SWAPPED_OUT] — 슬롯 교체 편집에서 **이전 일정에 있었고 새 일정에 없는** POI.
 *   사용자가 그 자리를 보고 바꾼 것이라 가장 명확한 신호다.
 * - [RejectedPoi.Kind.REGENERATED] — 재생성 직전 일정에 배치돼 있던 POI 전부.
 *   "이 구성이 싫다"에 가까워 약하게 본다.
 *
 * 강도 차이를 **여기서 다루지 않는다** — 강등 폭은 AI 설정이 갖는다(팀 결정 2026-09-26).
 * 백엔드는 사실(무엇을·몇 번)만 기억한다. 비율 조정에 백엔드 재배포가 필요 없게 하기 위함이다.
 *
 * ## 같은 곳을 또 거절하면 행이 아니라 count 가 는다
 *
 * AI 의 반복 강등 계단이 횟수로 오르므로(1회 → 3회+), 같은 (여행, POI, 종류)는 upsert 다.
 * [findByTrip] 이 돌려주는 [RejectedPoi.count] 가 그 누적값이다.
 */
interface RejectionStore {

    /** 거절을 기록한다. 이미 있으면 count+1. 빈 목록이면 아무것도 하지 않는다. */
    fun record(tripId: UUID, poiIds: Collection<UUID>, kind: RejectedPoi.Kind)

    /** 여행의 누적 거절 전부 — AI 요청 `rejections` 에 그대로 실리는 모양이다. */
    fun findByTrip(tripId: UUID): List<RejectedPoi>
}
