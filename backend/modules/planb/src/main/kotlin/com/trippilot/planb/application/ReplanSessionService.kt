package com.trippilot.planb.application

import com.trippilot.core.error.ConflictDetected
import com.trippilot.core.error.ResourceNotFound
import com.trippilot.planb.domain.ReplanMode
import com.trippilot.planb.domain.ReplanReason
import com.trippilot.planb.domain.ReplanSession
import com.trippilot.planb.domain.ReplanSessionRepository
import com.trippilot.trip.api.TripFacade
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import java.time.Clock
import java.time.LocalDate
import java.time.ZoneId
import java.util.UUID

/**
 * 재계획 진입(US-PLANB-01·12) — 사유·방식을 받아 세션을 연다.
 *
 * **여행 구간 안에서만** 연다. 재계획은 "지금 남은 일정"을 다시 짜는 일이라, 시작 전이면 재계획이 아니라
 * 그냥 생성이고 끝난 뒤면 되돌릴 대상이 없다. 구간 판정은 여행 날짜로만 한다 —
 * **숙소가 0건이어도 구간 안이면 허용**한다(등록 숙소는 재계획의 전제가 아니다).
 *
 * 일정 존재는 여기서 확인하지 않는다. 다른 모듈의 공개 계약(itinerary-generation `api`)에 조회 퍼사드가
 * 아직 없고, 진입만을 위해 크로스모듈 표면을 새로 여는 것은 이 티켓의 범위가 아니다.
 * 재계획할 게 없다는 사실은 **대안 산출 단계에서 사유로 드러난다**(`EmptyReason.NO_REMAINING_SLOTS`).
 */
@Service
class ReplanSessionService(
    private val trips: TripFacade,
    private val sessions: ReplanSessionRepository,
    private val clock: Clock,
) {

    @Transactional
    fun start(accountId: UUID, tripId: UUID, reason: ReplanReason, mode: ReplanMode): ReplanSession {
        val period = trips.findPeriod(accountId, tripId) ?: throw ResourceNotFound() // 소유·존재(404 은닉)
        val today = LocalDate.ofInstant(clock.instant(), TRAVEL_ZONE)
        if (today < period.startDate || today > period.endDate) {
            throw ConflictDetected(message = "여행 기간에만 재계획할 수 있습니다.")
        }
        // 진행 중 세션이 있으면 **새로 열지 않는다**. 둘이 열리면 어느 쪽을 확정할지 서버가 답할 수 없고
        // 되돌리기 기준도 갈라진다. 사유·방식이 달라졌을 수 있으니 조용히 재사용하지도 않는다 —
        // 현재 세션을 동봉해 돌려주고, 클라이언트가 이어가거나 취소 후 다시 열게 한다.
        sessions.findActiveByTrip(tripId)?.let {
            throw ConflictDetected(current = it.replanSessionId, message = "이미 진행 중인 재계획이 있습니다.")
        }
        return sessions.save(ReplanSession.start(tripId, reason, mode, clock.instant()))
    }

    @Transactional(readOnly = true)
    fun get(accountId: UUID, tripId: UUID, replanSessionId: UUID): ReplanSession {
        trips.findPeriod(accountId, tripId) ?: throw ResourceNotFound()
        // 세션을 **여행 범위로 좁혀** 찾는다 — id 만으로 찾으면 남의 여행 세션을 들여다볼 수 있다.
        return sessions.findById(replanSessionId)?.takeIf { it.tripId == tripId }
            ?: throw ResourceNotFound("재계획 세션을 찾을 수 없습니다.")
    }

    @Transactional
    fun cancel(accountId: UUID, tripId: UUID, replanSessionId: UUID): ReplanSession {
        val session = get(accountId, tripId, replanSessionId)
        if (session.isTerminal) throw ConflictDetected(message = "이미 끝난 재계획입니다.")
        return sessions.save(session.canceled(clock.instant()))
    }

    private companion object {
        /** 국내 여행 기준. 여행 "오늘"은 사용자가 있는 곳의 날짜지, 서버 UTC 날짜가 아니다. */
        private val TRAVEL_ZONE: ZoneId = ZoneId.of("Asia/Seoul")
    }
}
