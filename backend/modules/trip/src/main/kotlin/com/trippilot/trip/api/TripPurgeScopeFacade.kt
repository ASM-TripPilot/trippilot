package com.trippilot.trip.api

import java.util.UUID

/**
 * 파기 대상 범위 조회(C6 trip) — 공개 계약(R1, `..api..`).
 *
 * [TripListFacade] 와 나눈 이유는 **빠뜨리면 안 되는 조회**이기 때문이다. 그쪽은 화면용이라
 * `limit` 이 있고 삭제된 여행을 거르는데, 파기에 그걸 쓰면 **상한 밖 여행과 삭제된 여행의 데이터가
 * 조용히 남는다.** 목록이 비슷해 보여도 "못 지운 것"의 대가가 달라 같은 메서드를 공유하면 안 된다.
 */
interface TripPurgeScopeFacade {
    /**
     * 이 계정의 **모든** 여행 식별자 — 상한 없음, **삭제(soft delete)된 여행도 포함**.
     *
     * 삭제된 여행을 포함하는 이유: 행이 남아 있으면 그 아래 매달린 데이터도 남는다. 파기는
     * "보이는 것"이 아니라 "보관 중인 것"을 지우는 일이다.
     */
    fun findAllTripIdsOf(accountId: UUID): List<UUID>
}
