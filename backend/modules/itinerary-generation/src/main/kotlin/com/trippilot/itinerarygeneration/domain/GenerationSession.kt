package com.trippilot.itinerarygeneration.domain

import com.trippilot.core.error.ConflictDetected
import java.time.Instant
import java.util.UUID

/**
 * 생성 진행 상태(정본 §2.2 · BR-U3-04·05 · US-SCHED-09).
 *
 * 생성 POST 는 day1 만 담긴 `PARTIAL` 일정을 즉시 돌려준다. 화면이 그릴 **단계 텍스트·[백그라운드로]·[취소]**
 * 의 상태 원천이 없어 프론트(h09·h10)가 막혀 있었다 — 그 표면이 이 타입이다.
 *
 * **정본 §2.2 의 `partial`(day1 중간 결과)을 두지 않는다** — day1 은 이미 일정 행에 `PARTIAL` 상태로 있고
 * 화면도 일정 조회로 읽는다. 사본을 더 두면 갈라졌을 때 어느 쪽이 사실인지 알 수 없다.
 *
 * **진행률(퍼센트)을 저장하지 않는다.** 시각([startedAt]·[day1ReadyAt]·[finishedAt])에서 파생되는 값이라,
 * 따로 두면 실제 진행과 어긋날 수 있고 어긋났을 때 어느 쪽이 사실인지 알 수 없다.
 */
data class GenerationSession(
    val sessionId: UUID,
    val tripId: UUID,
    /** day1 확정 전에는 null — 일정 행이 생기기 전에도 세션은 존재한다. */
    val itineraryId: UUID?,
    val status: GenerationStatus,
    val mode: GenerationMode,
    /** 폴백 배너의 근거(BR-U3-11 · INV-4) — 경계 응답 전달분이며 백엔드가 재계산하지 않는다. */
    val isFallback: Boolean,
    val candidatesLevel: String?,
    val startedAt: Instant,
    val day1ReadyAt: Instant?,
    val finishedAt: Instant?,
) {
    companion object {
        fun start(tripId: UUID, mode: GenerationMode, at: Instant) = GenerationSession(
            UUID.randomUUID(), tripId, null, GenerationStatus.RUNNING, mode,
            isFallback = false, candidatesLevel = null, startedAt = at, day1ReadyAt = null, finishedAt = null,
        )

        @Suppress("LongParameterList")
        fun reconstitute(
            sessionId: UUID, tripId: UUID, itineraryId: UUID?, status: GenerationStatus, mode: GenerationMode,
            isFallback: Boolean, candidatesLevel: String?,
            startedAt: Instant, day1ReadyAt: Instant?, finishedAt: Instant?,
        ) = GenerationSession(
            sessionId, tripId, itineraryId, status, mode, isFallback, candidatesLevel,
            startedAt, day1ReadyAt, finishedAt,
        )
    }

    /** 아직 살아 있는가 — DB 부분 유니크 인덱스와 **같은 집합**이어야 한다. */
    val isRunning: Boolean
        get() = status == GenerationStatus.RUNNING || status == GenerationStatus.DAY1_READY

    /**
     * day1 이 나왔다 — 화면이 1일차를 먼저 그린다(BR-U3-04).
     * 폴백 여부·후보 등급을 여기서 함께 싣는다. 그래야 배너가 **첫 노출 시점부터** 사실을 말한다(BR-U3-11).
     */
    fun day1Ready(
        itineraryId: UUID,
        isFallback: Boolean,
        candidatesLevel: String?,
        at: Instant,
    ): GenerationSession {
        require(status == GenerationStatus.RUNNING) { "day1 전이는 RUNNING 에서만 가능합니다(현재 $status)." }
        return copy(
            itineraryId = itineraryId, status = GenerationStatus.DAY1_READY,
            isFallback = isFallback, candidatesLevel = candidatesLevel, day1ReadyAt = at,
        )
    }

    /** 전 일자 완료. */
    fun completed(isFallback: Boolean, candidatesLevel: String?, at: Instant): GenerationSession {
        require(isRunning) { "완료 전이는 진행 중일 때만 가능합니다(현재 $status)." }
        return copy(
            status = GenerationStatus.COMPLETED,
            isFallback = isFallback, candidatesLevel = candidatesLevel, finishedAt = at,
        )
    }

    /** 실패. day1 분은 일정에 남아 유효하다 — 세션만 닫는다(INV-4 침묵 금지). */
    fun failed(at: Instant): GenerationSession {
        require(isRunning) { "실패 전이는 진행 중일 때만 가능합니다(현재 $status)." }
        return copy(status = GenerationStatus.FAILED, finishedAt = at)
    }

    /**
     * `h09` [취소] — 세션을 닫는다. 부분 결과를 "버린다"(BR-U3-05)는 것은 **2차 결과를 반영하지 않는다**는 뜻이다
     * (`GenerationSessionService.isCanceled`). 이미 보여 준 day1 을 지우는 뜻이 아니다 — 사용자가 보던 화면이 비어 버린다.
     * `[백그라운드로]` 는 세션을 살린 채 화면만 이탈하는 것이라 **서버 동작이 없다** — 그래서 여기 대응 메서드가 없다.
     */
    fun canceled(at: Instant): GenerationSession {
        if (!isRunning) throw ConflictDetected(message = "이미 끝난 생성입니다.")
        return copy(status = GenerationStatus.CANCELED, finishedAt = at)
    }
}

enum class GenerationStatus { RUNNING, DAY1_READY, COMPLETED, FAILED, CANCELED }

interface GenerationSessionRepository {
    fun save(session: GenerationSession): GenerationSession

    fun findById(sessionId: UUID): GenerationSession?

    /** 진행 중 세션(RUNNING·DAY1_READY). 중복 생성을 막고 폴링 대상을 찾는 데 쓴다. */
    fun findRunningByTrip(tripId: UUID): GenerationSession?
}
