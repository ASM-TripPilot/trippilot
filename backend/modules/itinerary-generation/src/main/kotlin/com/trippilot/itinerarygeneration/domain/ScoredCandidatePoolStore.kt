package com.trippilot.itinerarygeneration.domain

import java.util.UUID

/**
 * 생성 시점 점수 후보 풀 저장(TRIP-969 · `trip_scored_candidate_pool` V2.55).
 *
 * 풀의 수명은 **최신 생성**이다 — 리비전처럼 쌓이지 않고 여행당 1행을 통째로 갈아끼운다.
 * 생성이 두 번의 AI 호출(1차 day1 · 2차 나머지)로 나뉘어 있어 쓰기가 둘로 갈린다:
 * 1차는 [replace](이전 생성의 풀을 버린다), 2차는 [merge](1차 풀에 합친다).
 */
interface ScoredCandidatePoolStore {

    /** 새 생성의 1차 — 이전 풀을 버리고 통째로 갈아끼운다. */
    fun replace(tripId: UUID, pool: ScoredCandidatePool)

    /**
     * 2차 — 저장돼 있는 풀에 합친다(같은 poiId 는 나중 값, 반경은 큰 쪽).
     * 저장된 풀이 없으면 [replace] 와 같다 — 1차가 풀 없이 왔어도 2차 몫은 남긴다.
     */
    fun merge(tripId: UUID, pool: ScoredCandidatePool)

    /** 직접 만들기 전환 — 낡은 풀이 남으면 이전 생성의 판단으로 즉답하게 되므로 지운다. */
    fun delete(tripId: UUID)

    fun find(tripId: UUID): ScoredCandidatePool?
}
