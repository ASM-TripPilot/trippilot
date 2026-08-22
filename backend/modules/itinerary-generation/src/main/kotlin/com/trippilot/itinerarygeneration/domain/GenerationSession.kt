package com.trippilot.itinerarygeneration.domain

import com.trippilot.core.error.ConflictDetected
import java.time.Duration
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
    /** 동시 생성 제한의 단위(TRIP-403). 세션을 여는 쪽이 아는 값이라 그때 함께 적는다. */
    val accountId: UUID,
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
        fun start(accountId: UUID, tripId: UUID, mode: GenerationMode, at: Instant) = GenerationSession(
            UUID.randomUUID(), tripId, accountId, null, GenerationStatus.RUNNING, mode,
            isFallback = false, candidatesLevel = null, startedAt = at, day1ReadyAt = null, finishedAt = null,
        )

        @Suppress("LongParameterList")
        fun reconstitute(
            sessionId: UUID, tripId: UUID, accountId: UUID, itineraryId: UUID?,
            status: GenerationStatus, mode: GenerationMode,
            isFallback: Boolean, candidatesLevel: String?,
            startedAt: Instant, day1ReadyAt: Instant?, finishedAt: Instant?,
        ) = GenerationSession(
            sessionId, tripId, accountId, itineraryId, status, mode, isFallback, candidatesLevel,
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

    /**
     * 실패 — 세션만 닫는다(INV-4 침묵 금지).
     *
     * **`FAILED` 는 두 경우를 함께 가리키며 [itineraryId] 가 그 둘을 가른다.** 상태를 쪼개지 않은 이유는
     * 이미 다른 필드로 파생되기 때문이다(진행률을 저장하지 않는 것과 같은 이유). 읽을 때 이 구분을 놓치기 쉬워
     * 여기 적어 둔다.
     *
     * - [itineraryId] `!= null` — day1 은 나왔고 **일정에 남아 유효하다.** 2차(나머지 일자)가 실패한 것이다
     * - [itineraryId] `== null` — day1 도 못 만들었다. **일정이 아예 없다.** 1차의 입력 조립·영속이 터진 경우이며,
     *   호출측이 예외를 다시 던져 요청 자체가 에러로 끝난다
     *
     * AI 호출 실패는 여기로 오지 않는다 — 결정론 최소 폴백이 받아 day1 을 만들고 `DAY1_READY` 로 간다.
     */
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

/**
 * 이 세션이 **너무 오래 살아 있는가**(TRIP-403).
 *
 * 백그라운드가 죽으면 세션이 RUNNING 인 채로 영원히 남는다. 그것이 계정 제한을 붙잡으면
 * **다른 여행을 영영 못 만들게 된다** — 규칙이 사용자를 가둔다. 오래된 세션은 제한에서 제외한다.
 *
 * [staleAfter] 는 **설정에서 온다**(`ScheduleDeadlineProperties.staleAfter`) — 중단된 2차를 쓸어담는
 * 스위퍼가 쓰는 것과 **같은 값**이다. 둘이 갈리면 "멈춘 생성"이 두 뜻이 되어, 같은 사고에도 day1 전에
 * 죽으면 이만큼, 뒤에 죽으면 저만큼 기다리게 된다. 사용자에게는 같은 상황이다.
 *
 * 상수가 아닌 이유: 시간제약을 걸지 않으면 정상 생성이 수 분을 쓸 수 있어(TRIP-474) 기준이 함께 늘어야
 * 한다. 고정해 두면 **살아 있는 생성을 죽은 것으로 보고 잘라낸다.**
 */
fun GenerationSession.isStale(at: Instant, staleAfter: Duration): Boolean =
    startedAt.isBefore(at.minus(staleAfter))

enum class GenerationStatus { RUNNING, DAY1_READY, COMPLETED, FAILED, CANCELED }

interface GenerationSessionRepository {
    fun save(session: GenerationSession): GenerationSession

    fun findById(sessionId: UUID): GenerationSession?

    /** 진행 중 세션(RUNNING·DAY1_READY). 중복 생성을 막고 폴링 대상을 찾는 데 쓴다. */
    fun findRunningByTrip(tripId: UUID): GenerationSession?

    /**
     * 이 **계정**에 진행 중인 세션(TRIP-403). 여러 건이면 가장 최근 것.
     *
     * 생성은 LLM·솔버를 쓰는 무거운 작업이라 동시 실행을 열어두면 비용·지연이 사용자 수가 아니라
     * **연타 횟수**에 비례한다. 제한 단위가 계정인 이유는 사용자가 체감하는 단위가 그것이기 때문이다.
     */
    fun findRunningByAccount(accountId: UUID): GenerationSession?

    /**
     * 이 계정의 생성 시작을 **직렬화한다**(TRIP-403). 트랜잭션이 끝나면 자동으로 풀린다.
     *
     * [findRunningByAccount] 로 보고 판단해서 쓰는 사이에 다른 요청이 끼어들 수 있다. 그러면 둘 다
     * "진행 중 없음"으로 읽고 각자 INSERT 해 **유니크 인덱스에 걸린 쪽이 500** 을 받는다 — 데이터는
     * 지켜지지만 사용자에게는 안내 없는 오류다. 여기서 줄을 세워 뒤에 온 쪽이 앞의 결과를 보고
     * 제대로 409 를 받게 한다.
     *
     * 잠금을 무는 구간은 세션 행 두어 개를 쓰는 동안뿐이다 — 생성 자체는 이 트랜잭션 밖에서 돈다.
     */
    fun lockAccount(accountId: UUID)
}
