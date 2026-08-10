package com.trippilot.planb.domain

import com.trippilot.core.error.FieldError
import com.trippilot.core.error.ValidationFailed
import java.time.Instant
import java.util.UUID

/**
 * 재계획 세션(US-PLANB-01·02·12) — "지금부터 일정을 다시 짠다"는 한 번의 시도.
 *
 * 왜 세션인가: 재계획은 **한 번의 요청으로 끝나지 않는다**. 진입(사유·방식) → 대안 산출(비동기·외부 의존)
 * → 사용자가 고름 → 확정/취소 가 이어진다. 그 사이 사용자는 앱을 닫을 수도 있고 대안이 0건일 수도 있다.
 * 상태를 세션에 담아야 "왜 대안이 없는지", "무엇을 되돌릴지"를 나중에도 말할 수 있다(침묵 금지 INV-4).
 *
 * 상태 전이: `LOADING → PROPOSED → COMMITTED | CANCELED`, 그리고 `COMMITTED → UNDONE`.
 * 대안이 0건이어도 [ReplanStatus.PROPOSED] 로 간다 — **"없음"도 결과다**(사유는 [emptyReason]).
 */
class ReplanSession private constructor(
    val replanSessionId: UUID,
    val tripId: UUID,
    val reason: ReplanReason,
    val mode: ReplanMode,
    val status: ReplanStatus,
    /** 대안이 0건인 이유. 상태가 PROPOSED 이고 대안이 없을 때만 채워진다. */
    val emptyReason: EmptyReason?,
    val createdAt: Instant,
    val updatedAt: Instant,
) {
    companion object {
        fun start(tripId: UUID, reason: ReplanReason, mode: ReplanMode, at: Instant): ReplanSession =
            ReplanSession(UUID.randomUUID(), tripId, reason, mode, ReplanStatus.LOADING, null, at, at)

        /** 영속본 재구성 — 검증하지 않는다(저장 시점에 이미 통과했다). */
        fun reconstitute(
            replanSessionId: UUID,
            tripId: UUID,
            reason: ReplanReason,
            mode: ReplanMode,
            status: ReplanStatus,
            emptyReason: EmptyReason?,
            createdAt: Instant,
            updatedAt: Instant,
        ) = ReplanSession(replanSessionId, tripId, reason, mode, status, emptyReason, createdAt, updatedAt)
    }

    /**
     * 대안 산출이 끝났다. **0건이어도 여기로 온다** — 그때는 [emptyReason] 이 반드시 있어야 한다.
     * 이유 없는 빈 목록은 "아직 로딩 중"인지 "찾아봤지만 없음"인지 화면이 구분할 수 없다.
     */
    fun proposed(alternativeCount: Int, emptyReason: EmptyReason?, at: Instant): ReplanSession {
        require(status == ReplanStatus.LOADING) { "제안은 LOADING 에서만 가능합니다(현재 $status)." }
        if (alternativeCount == 0 && emptyReason == null) {
            throw ValidationFailed(listOf(FieldError("emptyReason", "대안이 0건이면 사유가 있어야 합니다.")))
        }
        val reasonToKeep = if (alternativeCount == 0) emptyReason else null
        return copy(status = ReplanStatus.PROPOSED, emptyReason = reasonToKeep, at = at)
    }

    fun committed(at: Instant): ReplanSession {
        require(status == ReplanStatus.PROPOSED) { "확정은 PROPOSED 에서만 가능합니다(현재 $status)." }
        return copy(status = ReplanStatus.COMMITTED, emptyReason = emptyReason, at = at)
    }

    fun canceled(at: Instant): ReplanSession {
        require(status == ReplanStatus.LOADING || status == ReplanStatus.PROPOSED) {
            "취소는 진행 중일 때만 가능합니다(현재 $status)."
        }
        return copy(status = ReplanStatus.CANCELED, emptyReason = emptyReason, at = at)
    }

    /** 확정을 되돌린다. 되돌린 사실 자체는 남는다 — 세션을 지우지 않는다(이력이 곧 근거다). */
    fun undone(at: Instant): ReplanSession {
        require(status == ReplanStatus.COMMITTED) { "되돌리기는 COMMITTED 에서만 가능합니다(현재 $status)." }
        return copy(status = ReplanStatus.UNDONE, emptyReason = emptyReason, at = at)
    }

    /** 더 이상 전이가 없는 상태 — 같은 여행에 새 세션을 열 수 있다. */
    val isTerminal: Boolean
        get() = status == ReplanStatus.COMMITTED || status == ReplanStatus.CANCELED || status == ReplanStatus.UNDONE

    private fun copy(status: ReplanStatus, emptyReason: EmptyReason?, at: Instant) =
        ReplanSession(replanSessionId, tripId, reason, mode, status, emptyReason, createdAt, at)
}

/** 재계획 사유(i10). 사용자가 고르며, 어댑터로 그대로 전달돼 대안 성격을 좌우한다. */
enum class ReplanReason { WEATHER, CLOSED, DELAY, CANCELED, FATIGUE, NONE }

/** 재계획 방식(US-PLANB-12). AI = 대안 제안, MANUAL = 사용자가 직접 고침. */
enum class ReplanMode { AI, MANUAL }

/** 세션 상태. 스키마 정본(`전체-최소-스키마-설명.md`)의 loading→proposed→committed/canceled/undone. */
enum class ReplanStatus { LOADING, PROPOSED, COMMITTED, CANCELED, UNDONE }

/**
 * 대안이 0건인 이유. **닫힌 집합**이라야 화면이 문구를 정할 수 있다 —
 * 자유 문자열이면 클라이언트가 분기하지 못하고 그대로 노출하게 된다.
 */
enum class EmptyReason {
    /** 남은 일정이 없다(마지막 방문지 이후). */
    NO_REMAINING_SLOTS,

    /** 후보가 없다 — 반경·시간대 조건에서 대체할 장소를 못 찾았다. */
    NO_CANDIDATES,

    /** 경계(AI)가 대안 산출을 아직 제공하지 않는다. 계약 공백이며 사용자 잘못이 아니다. */
    NOT_AVAILABLE,

    /** 외부 의존 실패로 산출하지 못했다. 재시도하면 달라질 수 있다. */
    UPSTREAM_FAILED,
}

/** 재계획 세션 영속 포트. */
interface ReplanSessionRepository {
    fun save(session: ReplanSession): ReplanSession

    fun findById(replanSessionId: UUID): ReplanSession?

    /** 해당 여행에 아직 끝나지 않은 세션(LOADING·PROPOSED). 중복 진입을 막는 데 쓴다. */
    fun findActiveByTrip(tripId: UUID): ReplanSession?
}
