package com.trippilot.trip.api

import java.time.LocalDate
import java.util.UUID

/**
 * 여행의 **소유자**를 알아내는 조회(C6 trip) — 공개 계약(R1, `..api..`).
 *
 * [TripFacade] 와 따로 두는 이유는 호출 맥락이 다르기 때문이다. 그쪽 메서드는 전부 `accountId` 를 받아
 * "이 사람의 여행인가"를 걸러내는데, 여기 호출자는 **아웃박스 구독자**라 사용자 맥락이 아예 없다 —
 * 알림을 누구에게 보낼지 정하려면 소유자를 알아내는 것 자체가 목적이다.
 * (`TripFacade` 에 메서드를 얹지 않은 실무적 이유도 있다 — 그 인터페이스는 네 모듈의 테스트 대역
 * 스무 곳이 구현하고 있어, 메서드 하나가 그 전부를 건드린다.)
 */
interface TripOwnerFacade {
    /** 삭제된 여행이면 null — 지워진 여행의 리마인드는 만들지 않는다. */
    fun findOwnedPeriod(tripId: UUID): OwnedTripPeriod?
}

/** 소유자 + 계획일 구간 [startDate, endDate](체크아웃일 포함, [TripGenerationContext] 와 같은 규약). */
data class OwnedTripPeriod(val accountId: UUID, val startDate: LocalDate, val endDate: LocalDate)
