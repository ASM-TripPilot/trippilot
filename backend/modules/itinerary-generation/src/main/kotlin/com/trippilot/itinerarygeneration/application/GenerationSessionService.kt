package com.trippilot.itinerarygeneration.application

import com.trippilot.core.error.ResourceNotFound
import com.trippilot.itinerarygeneration.domain.GenerationMode
import com.trippilot.itinerarygeneration.domain.GenerationSession
import com.trippilot.itinerarygeneration.domain.GenerationSessionRepository
import com.trippilot.trip.api.TripFacade
import org.slf4j.LoggerFactory
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import java.time.Clock
import java.util.UUID

/**
 * 생성 진행 상태(LC · TRIP-312 · BR-U3-04·05).
 *
 * 화면(h09·h10)이 **단계 텍스트·[백그라운드로]·[취소]** 를 그리려면 상태 원천이 필요하다.
 * 생성 POST 가 완성본을 동기 반환하던 시절에는 그릴 값이 없었고, 2단계 생성이 들어오며 비로소 의미가 생겼다.
 *
 * **진행률(퍼센트)을 만들지 않는다** — 계약에 그 값이 없고, 지어내면 사용자가 남은 시간을 오판한다.
 * 화면은 시각(`startedAt`·`day1ReadyAt`)으로 단계를 판단한다.
 */
@Service
class GenerationSessionService(
    private val trips: TripFacade,
    private val sessions: GenerationSessionRepository,
    private val clock: Clock,
) {

    /**
     * 생성 시작 시 세션을 연다. 이전 세션이 살아 있으면 **닫고 시작한다** —
     * 재생성은 정상 흐름이라 막으면 사용자가 다시 만들 수 없다(재계획 세션과 같은 판단).
     */
    @Transactional
    fun start(tripId: UUID, mode: GenerationMode): GenerationSession {
        val now = clock.instant()
        sessions.findRunningByTrip(tripId)?.let {
            log.info("이전 생성 세션을 닫고 새로 시작합니다 — tripId={} previous={}", tripId, it.sessionId)
            sessions.save(it.canceled(now))
        }
        return sessions.save(GenerationSession.start(tripId, mode, now))
    }

    /** day1 이 나왔다 — 화면이 1일차를 먼저 그린다(BR-U3-04). */
    @Transactional
    fun day1Ready(
        sessionId: UUID,
        itineraryId: UUID,
        isFallback: Boolean,
        candidatesLevel: String?,
    ): GenerationSession? = sessions.findById(sessionId)?.let {
        sessions.save(it.day1Ready(itineraryId, isFallback, candidatesLevel, clock.instant()))
    }

    /** 전 일자 완료. 취소된 세션이면 아무 일도 하지 않는다 — 사용자가 이미 그만두겠다고 했다. */
    @Transactional
    fun completed(sessionId: UUID, isFallback: Boolean, candidatesLevel: String?): GenerationSession? =
        sessions.findById(sessionId)?.takeIf { it.isRunning }
            ?.let { sessions.save(it.completed(isFallback, candidatesLevel, clock.instant())) }

    /** 2차 실패. day1 분은 일정에 남아 유효하다(INV-4 침묵 금지). */
    @Transactional
    fun failed(sessionId: UUID): GenerationSession? =
        sessions.findById(sessionId)?.takeIf { it.isRunning }
            ?.let { sessions.save(it.failed(clock.instant())) }

    /** 폴링 조회. 세션 id 를 알아도 **여행 범위 밖이면 못 본다**. */
    @Transactional(readOnly = true)
    fun get(accountId: UUID, tripId: UUID, sessionId: UUID): GenerationSession {
        trips.findPeriod(accountId, tripId) ?: throw ResourceNotFound() // 소유·존재(404 은닉)
        return sessions.findById(sessionId)?.takeIf { it.tripId == tripId }
            ?: throw ResourceNotFound("생성 세션을 찾을 수 없습니다.")
    }

    /**
     * `h09` [취소] — 세션을 닫고 부분 결과를 버린다(BR-U3-05).
     * `[백그라운드로]` 는 **서버 동작이 없다** — 세션을 살린 채 화면만 이탈하는 것이라 여기 대응 오퍼레이션이 없다.
     */
    @Transactional
    fun cancel(accountId: UUID, tripId: UUID, sessionId: UUID): GenerationSession =
        sessions.save(get(accountId, tripId, sessionId).canceled(clock.instant()))

    /** 여행의 진행 중 세션을 실패로 닫는다 — 중단된 생성 정리([StalePartialSweeper])가 쓴다. */
    @Transactional
    fun failRunning(tripId: UUID): GenerationSession? =
        sessions.findRunningByTrip(tripId)?.let { sessions.save(it.failed(clock.instant())) }

    /** 진행 중 세션 id — 일정 응답이 [취소]·폴링 대상을 함께 싣는다. 진행 중이 아니면 null. */
    @Transactional(readOnly = true)
    fun runningIdOf(tripId: UUID): UUID? = sessions.findRunningByTrip(tripId)?.sessionId

    /** 2차가 결과를 반영해도 되는가 — 취소된 세션이면 버린다(BR-U3-05). */
    @Transactional(readOnly = true)
    fun isCanceled(sessionId: UUID): Boolean = sessions.findById(sessionId)?.isRunning == false

    private companion object {
        private val log = LoggerFactory.getLogger(GenerationSessionService::class.java)
    }
}
