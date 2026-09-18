package com.trippilot.recalculation.application

import com.trippilot.archive.api.ArchiveFacade
import com.trippilot.core.error.ConflictDetected
import com.trippilot.core.error.ResourceNotFound
import com.trippilot.itinerarygeneration.api.ItineraryFacade
import com.trippilot.placedata.api.PoiSurfaceFacade
import com.trippilot.recalculation.domain.ReplanOrigin
import com.trippilot.recalculation.domain.ReplanScope
import com.trippilot.recalculation.domain.ReplanSession
import com.trippilot.recalculation.domain.ReplanSessionRepository
import com.trippilot.core.event.DomainEventPublisher
import com.trippilot.itinerarygeneration.api.ReplanCommand
import com.trippilot.itinerarygeneration.api.ReplanFacade
import com.trippilot.itinerarygeneration.api.ReplanProposal
import com.trippilot.recalculation.api.event.ItineraryRecalculated
import com.trippilot.recalculation.domain.ReplanStatus
import com.trippilot.trip.api.TripFacade
import org.slf4j.LoggerFactory
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import org.springframework.transaction.support.TransactionSynchronization
import org.springframework.transaction.support.TransactionSynchronizationManager
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
    private val archive: ArchiveFacade,
    private val poiSurfaces: PoiSurfaceFacade,
    private val solver: ReplanSolver,
    private val replans: ReplanFacade,
    private val events: DomainEventPublisher,
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

        // 마지막 완료 방문지 좌표(있으면). 정본에서 사라진 POI 면 null 이 되고 사다리가 다음 단으로 내려간다.
        val lastVisit = archive.findLastCompletedPoi(tripId)
            ?.let { poiSurfaces.findSurfaces(listOf(it))[it] }

        val now = clock.instant()
        // INV-U4-06 — 기존 열린 세션은 **닫고 시작한다**. 이전 시도의 draft 는 그 세션에 남아 이력이 된다.
        sessions.findOpenByTrip(tripId)?.let {
            log.info("이전 재계획 세션을 닫고 새로 시작합니다 — tripId={} previous={}", tripId, it.sessionId)
            sessions.save(it.canceled(now))
        }

        val opened = sessions.save(
            ReplanSession.start(
                tripId = tripId,
                itineraryId = itinerary.itineraryId,
                triggerId = request.triggerId,
                scope = request.scope,
                fromInstant = now, // '지금 이후'가 기준 — 이미 지난 슬롯은 대상이 아니다
                // 위치를 못 잡았어도 **막지 않는다** — 사다리를 내려가 가정을 밝힌다(BR-U4-19).
                // 사다리 3단(마지막 완료 방문지)이 방문 실적 도착으로 실제로 채워진다(BR-U4-19).
                // 좌표는 POI 정본에서 얻는다 — 실적은 poiId 만 들고 있다.
                origin = origins.resolve(
                    tripId, period.startDate, period.endDate, today, request.origin,
                    lastVisitLat = lastVisit?.lat, lastVisitLng = lastVisit?.lng,
                ),
                reasons = request.reasons,
                directives = request.directives,
                freeText = request.freeText,
                excludedPoiIds = request.excludedPoiIds,
                at = now,
            ),
        )
        // 시트를 제출하면 곧바로 산출로 넘어간다 — 여기서 시작하지 않으면 세션이 COLLECTING 에 멈춰
        // **영원히 로딩**이 된다. 산출은 비동기라 응답은 SOLVING 이고, 화면(i12)은 세션을 폴링해 로딩을 그린다.
        val solving = sessions.save(opened.solving())
        // **커밋된 뒤에** 시작한다 — 트랜잭션 안에서 부르면 비동기 스레드가 아직 없는 행을 읽어(다른 커넥션)
        // 조용히 아무것도 하지 않고, 세션은 SOLVING 에 영원히 멈춘다(실측: E2E 가 20초 폴링 끝에 잡았다).
        afterCommit { solver.solve(accountId, solving.sessionId) }
        return solving
    }

    /**
     * `i18` [확정] — **일정이 바뀌는 유일한 지점**이다(INV-U4-05).
     * 반영 후에는 세션을 닫아 같은 초안이 두 번 반영되지 않게 한다.
     */
    @Transactional
    fun apply(accountId: UUID, tripId: UUID, sessionId: UUID): ReplanSession {
        val session = get(accountId, tripId, sessionId)
        if (session.status != ReplanStatus.DRAFT) {
            throw ConflictDetected(message = "확정할 재계획안이 없습니다.")
        }
        val draft = session.draft ?: throw ConflictDetected(message = "재계획안이 비어 있습니다.")
        replans.apply(accountId, tripId, ReplanProposal.fromMap(draft), changeReason(session))
        val applied = sessions.save(session.applied(clock.instant()))
        events.publish(ItineraryRecalculated(tripId.toString(), sessionId.toString()))
        return applied
    }

    /**
     * 이력의 `reason` 한 줄(BR-U4-31) — 진입 경로 + 사유 + 방향 지시어 + 자유입력을 ` · ` 로 잇는다.
     * 예: `자동 감지 · 비 예보 · 실내로`.
     *
     * **비워서 넘기지 않는다.** 사유·지시어를 하나도 안 고른 수동 진입이면 최소한 "여행 중 재계획"이라도 남긴다 —
     * 빈 칸은 이력을 열었을 때 "왜 바꿨는지"를 되짚을 근거를 없앤다(US-PLANB-09 의 목적 자체).
     *
     * 트리거 **요약**(예: `날씨(비 예보 70%)`)까지는 싣지 못한다 — 그 문구는 C9(planb-detection) 소유인데
     * C10 은 C9 에 의존하지 않는다. 표시 문자열 하나 때문에 모듈 의존을 늘리지 않고, 자동 진입이라는
     * 사실만 `triggerId` 유무로 남긴다(정본 §7 대비 축약 — 트리거 상세가 필요해지면 그때 경계를 연다).
     */
    private fun changeReason(session: ReplanSession): String {
        val parts = buildList {
            if (session.triggerId != null) add("자동 감지")
            addAll(session.reasons)
            addAll(session.directives)
            session.freeText?.takeIf { it.isNotBlank() }?.let { add(it.trim()) }
        }.filter { it.isNotBlank() }
        return parts.joinToString(REASON_SEPARATOR).ifBlank { DEFAULT_REASON }.take(REASON_MAX)
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

    /** 트랜잭션이 없으면(테스트 등) 그 자리에서 실행 — 결정론을 잃지 않는다. */
    private fun afterCommit(action: () -> Unit) {
        if (!TransactionSynchronizationManager.isSynchronizationActive()) return action()
        TransactionSynchronizationManager.registerSynchronization(
            object : TransactionSynchronization {
                override fun afterCommit() = action()
            },
        )
    }

    private companion object {
        private val log = LoggerFactory.getLogger(ReplanSessionService::class.java)

        /** 여행 "오늘"은 사용자가 있는 곳의 날짜지, 서버 UTC 날짜가 아니다. */
        private val TRAVEL_ZONE: ZoneId = ZoneId.of("Asia/Seoul")

        private const val REASON_SEPARATOR = " · "

        /** 사유·지시어를 하나도 안 고른 수동 진입의 최소 문구 — 빈 칸으로 남기지 않는다(BR-U4-31). */
        private const val DEFAULT_REASON = "여행 중 재계획"

        /** `change_log_entry.reason` 은 varchar(500) — 넘치면 저장이 통째로 실패한다(자유입력이 길 수 있다). */
        private const val REASON_MAX = 500
    }
}
