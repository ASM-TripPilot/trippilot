package com.trippilot.trip.api

import java.util.UUID

/**
 * 여행이 아직 살아 있는가(C6) — 공개 계약(R1, `..api..`).
 *
 * [TripListFacade] 에 얹지 않은 이유는 파급이다. 그쪽은 대역이 셋(archive · reflection 테스트)이라
 * 메서드 하나가 그 전부를 건드린다. 여기 호출자는 숙소 목록(U6 `l04`)이고 묻는 것도 다르다 —
 * 목록이 아니라 **주어진 id 들 중 살아 있는 것**이다.
 *
 * 구현은 [TripListFacade] 와 같은 빈이 한다 — 계약만 좁게 열고 구현은 늘리지 않는다.
 */
interface TripLivenessFacade {
    /**
     * [tripIds] 중 이 계정 소유이고 **삭제되지 않은** 것만 돌려준다.
     *
     * 목록 상한으로 거르지 않는 이유가 이것이다 — "최신 N건"으로 물으면 상한 밖의 연결이
     * 조용히 사라져 "연결된 여행 없음"으로 보인다.
     */
    fun filterLiveTrips(accountId: UUID, tripIds: Collection<UUID>): Set<UUID>
}
