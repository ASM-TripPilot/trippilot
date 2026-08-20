package com.trippilot.itinerarygeneration.application

import com.trippilot.core.error.ConflictDetected
import com.trippilot.core.error.ErrorCode
import com.trippilot.core.error.ResourceNotFound
import com.trippilot.itinerarygeneration.domain.GenerationMode
import com.trippilot.itinerarygeneration.domain.GenerationSession
import com.trippilot.itinerarygeneration.domain.GenerationSessionRepository
import com.trippilot.itinerarygeneration.domain.isStale
import com.trippilot.trip.api.TripFacade
import org.slf4j.LoggerFactory
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import java.time.Clock
import java.time.Instant
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
     * 생성 시작 시 세션을 연다.
     *
     * **같은 여행의 재생성은 막지 않는다** — 이전 세션을 닫고 새로 시작한다. 재생성은 멈춘 생성(PARTIAL)에서
     * 벗어나는 **유일한 탈출구**라(openapi `/trips/{tripId}/itinerary` 주석) 막으면 사용자가 갇힌다.
     *
     * **다른 여행의 생성이 돌고 있으면 거절한다**(TRIP-403). 생성은 LLM·솔버를 쓰는 무거운 작업이라
     * 동시 실행을 열어두면 비용·지연이 사용자 수가 아니라 **연타 횟수**에 비례한다.
     * 업무 규칙의 권한은 서버에 있다 — 클라만 막으면 규칙이 아니다.
     */
    @Transactional
    fun start(accountId: UUID, tripId: UUID, mode: GenerationMode): GenerationSession {
        val now = clock.instant()
        guardSingleActive(accountId, tripId, now)
        sessions.findRunningByTrip(tripId)?.let {
            log.info("이전 생성 세션을 닫고 새로 시작합니다 — tripId={} previous={}", tripId, it.sessionId)
            sessions.save(it.canceled(now))
        }
        return sessions.save(GenerationSession.start(accountId, tripId, mode, now))
    }

    /**
     * 계정당 진행 중 생성은 하나다.
     *
     * **오래 살아 있는 세션은 제한에서 뺀다.** 백그라운드가 죽으면 세션이 RUNNING 인 채 영원히 남는데,
     * 그것이 제한을 붙잡으면 다른 여행을 **영영** 못 만들게 된다 — 규칙이 사용자를 가둔다.
     * 죽은 세션은 여기서 닫아 두어 폴링하던 화면도 끝을 본다(INV-4: 침묵하지 않는다).
     *
     * 거절할 때 **어느 여행이 진행 중인지** 함께 보낸다. 사유만 주면 사용자는 무엇을 기다려야 할지 모른다.
     */
    private fun guardSingleActive(accountId: UUID, tripId: UUID, now: Instant) {
        // 읽기 **전에** 줄을 세운다. 보고 판단해서 쓰는 사이가 열려 있으면 동시 요청 둘이 함께
        // "진행 중 없음"으로 읽고, 유니크에 걸린 쪽이 409 대신 500 을 받는다.
        sessions.lockAccount(accountId)

        val active = sessions.findRunningByAccount(accountId) ?: return
        if (active.tripId == tripId) return // 같은 여행 — 탈출구는 항상 열려 있다

        if (active.isStale(now)) {
            log.warn(
                "멈춘 생성 세션을 닫습니다 — 제한이 사용자를 가두지 않게. sessionId={} tripId={} startedAt={}",
                active.sessionId, active.tripId, active.startedAt,
            )
            sessions.save(active.failed(now))
            return
        }

        // 어느 여행이 도는지 함께 준다 — 사유만 주면 사용자는 무엇이 끝나기를 기다릴지 모른다.
        // 전용 코드를 쓴다: 기본 CONFLICT 로는 화면이 닉네임 중복 409 와 구분하지 못한다.
        throw ConflictDetected(
            current = active.tripId,
            errorCode = ErrorCode.GENERATION_IN_PROGRESS,
            message = "다른 여행의 일정을 만들고 있어요. 끝나면 다시 시도해 주세요.",
        )
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

