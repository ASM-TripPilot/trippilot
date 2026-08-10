package com.trippilot.recalculation.application

import com.trippilot.core.error.ConflictDetected
import com.trippilot.core.error.ResourceNotFound
import com.trippilot.itinerarygeneration.api.ItineraryFacade
import com.trippilot.recalculation.domain.ReplanOrigin
import com.trippilot.recalculation.domain.ReplanScope
import com.trippilot.recalculation.domain.ReplanSession
import com.trippilot.recalculation.domain.ReplanSessionRepository
import com.trippilot.trip.api.TripFacade
import org.slf4j.LoggerFactory
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import java.time.Clock
import java.time.LocalDate
import java.time.ZoneId
import java.util.UUID

/** 재계획 진입 입력(`i10`). 어휘는 화면이 정하고 서버는 그대로 싣는다. */
data class StartReplan(
    val scope: ReplanScope,
    /** 클라이언트가 알려준 기준점. **null 이면 서버가 사다리로 정한다**(BR-U4-19). */
    val origin: ReplanOrigin?,
    val reasons: List<String>,
    val directives: List<String>,
    val freeText: String?,
    val excludedPoiIds: List<UUID>,
    /** 자동 진입이면 근거 트리거. 수동이면 null. */
    val triggerId: UUID?,
)

/**
 * 재계획 세션 수명 관리(C10 · LC-U4-4).
 *
 * 두 불변식이 이 클래스의 존재 이유다:
 * - **INV-U4-05** 확정 전에는 원 일정에 아무것도 쓰지 않는다 — 취소는 세션만 닫는다.
 * - **INV-U4-06** 한 여행에 열린 세션은 최대 1개. 새 진입은 **기존 세션을 CANCELED 로 닫고 시작**한다.
 *   (거부하지 않는다 — 사용자가 앱을 닫았다 다시 들어온 경우가 정상 흐름이라, 막으면 영영 못 들어간다.)
 */
@Service
class ReplanSessionService(
    private val trips: TripFacade,
    private val itineraries: ItineraryFacade,
    private val sessions: ReplanSessionRepository,
    private val origins: OriginResolver,
    private val clock: Clock,
) {

    @Transactional
    fun start(accountId: UUID, tripId: UUID, request: StartReplan): ReplanSession {
        val period = trips.findPeriod(accountId, tripId) ?: throw ResourceNotFound() // 소유·존재(404 은닉)
        val today = LocalDate.ofInstant(clock.instant(), TRAVEL_ZONE)
        if (today < period.startDate || today > period.endDate) {
            throw ConflictDetected(message = "여행 기간에만 재계획할 수 있습니다.")
        }
        // 다시 짤 일정이 있어야 재계획이다. 없으면 그건 '생성'이지 재계획이 아니다.
        val itinerary = itineraries.findCurrent(accountId, tripId)
            ?: throw ResourceNotFound("생성된 일정이 없습니다.")

        val now = clock.instant()
        // INV-U4-06 — 기존 열린 세션은 **닫고 시작한다**. 이전 시도의 draft 는 그 세션에 남아 이력이 된다.
        sessions.findOpenByTrip(tripId)?.let {
            log.info("이전 재계획 세션을 닫고 새로 시작합니다 — tripId={} previous={}", tripId, it.sessionId)
            sessions.save(it.canceled(now))
        }

        return sessions.save(
            ReplanSession.start(
                tripId = tripId,
                itineraryId = itinerary.itineraryId,
                triggerId = request.triggerId,
                scope = request.scope,
                fromInstant = now, // '지금 이후'가 기준 — 이미 지난 슬롯은 대상이 아니다
                // 위치를 못 잡았어도 **막지 않는다** — 사다리를 내려가 가정을 밝힌다(BR-U4-19).
                origin = origins.resolve(tripId, period.startDate, period.endDate, today, request.origin),
                reasons = request.reasons,
                directives = request.directives,
                freeText = request.freeText,
                excludedPoiIds = request.excludedPoiIds,
                at = now,
            ),
        )
    }

    @Transactional(readOnly = true)
    fun get(accountId: UUID, tripId: UUID, sessionId: UUID): ReplanSession {
        trips.findPeriod(accountId, tripId) ?: throw ResourceNotFound()
        // 세션을 **여행 범위로 좁혀** 찾는다 — id 만으로 찾으면 남의 여행 세션을 들여다볼 수 있다.
        return sessions.findById(sessionId)?.takeIf { it.tripId == tripId }
            ?: throw ResourceNotFound("재계획 세션을 찾을 수 없습니다.")
    }

    /** `i18` [취소] — 세션만 닫는다. 원 일정은 건드리지 않는다(INV-U4-05). */
    @Transactional
    fun cancel(accountId: UUID, tripId: UUID, sessionId: UUID): ReplanSession {
        val session = get(accountId, tripId, sessionId)
        if (!session.isOpen) throw ConflictDetected(message = "이미 끝난 재계획입니다.")
        return sessions.save(session.canceled(clock.instant()))
    }

    private companion object {
        private val log = LoggerFactory.getLogger(ReplanSessionService::class.java)

        /** 여행 "오늘"은 사용자가 있는 곳의 날짜지, 서버 UTC 날짜가 아니다. */
        private val TRAVEL_ZONE: ZoneId = ZoneId.of("Asia/Seoul")
    }
}
