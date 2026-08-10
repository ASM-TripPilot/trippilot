package com.trippilot.recalculation.domain

import java.time.Instant
import java.util.UUID

/**
 * 재계획 세션(C10 · 정본 §3.2) — `i10` 제출부터 `i18` 확정/취소까지의 수명.
 *
 * **INV-U4-05**: `APPLIED` 가 되기 전에는 `itinerary`·`visit_slot` 에 어떤 쓰기도 발생하지 않는다.
 * 재계획안은 [draft] 에만 있고, 취소는 세션만 닫는다. 그래서 "확정 전에 원 일정이 흔들리는" 일이 없다.
 *
 * 상태: `COLLECTING`(입력 모으는 중) → `SOLVING`(산출 중) → `DRAFT`(제안 완료, 사용자가 고르는 중)
 * → `APPLIED` | `CANCELED`, 그리고 산출 실패는 `FAILED`(오류) · `NO_SOLUTION`(해가 없음)로 갈린다.
 * 실패를 하나로 뭉치지 않는 이유: 사용자가 할 일이 다르다 — 전자는 재시도, 후자는 조건 완화다.
 */
data class ReplanSession(
    val sessionId: UUID,
    val tripId: UUID,
    val itineraryId: UUID,
    /** 자동 진입이면 근거 트리거. 수동 진입이면 null. */
    val triggerId: UUID?,
    val scope: ReplanScope,
    /** '지금 이후'의 기준점 — 이 시각 이전 슬롯은 재계획 대상이 아니다. */
    val fromInstant: Instant,
    val origin: ReplanOrigin,
    /** `i10` 의 '왜'(다중). 서버가 어휘를 강제하지 않는다 — 화면이 고른 값을 그대로 싣는다. */
    val reasons: List<String>,
    /** `i10` 의 '어떻게'(다중). */
    val directives: List<String>,
    val freeText: String?,
    /** '건너뛰기'가 채운다 — 재계획 시 후보에서 뺀다. */
    val excludedPoiIds: List<UUID>,
    val status: ReplanStatus,
    /** 산출된 재계획안. 확정 전에는 여기에만 존재한다(INV-U4-05). */
    val draft: Map<String, Any>?,
    val createdAt: Instant,
    val closedAt: Instant?,
) {
    companion object {
        fun start(
            tripId: UUID,
            itineraryId: UUID,
            triggerId: UUID?,
            scope: ReplanScope,
            fromInstant: Instant,
            origin: ReplanOrigin,
            reasons: List<String>,
            directives: List<String>,
            freeText: String?,
            excludedPoiIds: List<UUID>,
            at: Instant,
        ) = ReplanSession(
            UUID.randomUUID(), tripId, itineraryId, triggerId, scope, fromInstant, origin,
            reasons, directives, freeText, excludedPoiIds,
            ReplanStatus.COLLECTING, null, at, null,
        )
    }

    /** 열린 세션인가 — INV-U4-06 의 "최대 1개" 판정 기준이며, DB 부분 유니크 인덱스와 **같은 집합**이어야 한다. */
    val isOpen: Boolean
        get() = status == ReplanStatus.COLLECTING || status == ReplanStatus.SOLVING || status == ReplanStatus.DRAFT

    fun solving(): ReplanSession {
        require(status == ReplanStatus.COLLECTING) { "산출은 COLLECTING 에서만 시작합니다(현재 $status)." }
        return copy(status = ReplanStatus.SOLVING)
    }

    /** 재계획안이 나왔다. 원 일정에는 아직 아무것도 쓰지 않는다(INV-U4-05). */
    fun drafted(draft: Map<String, Any>): ReplanSession {
        require(status == ReplanStatus.SOLVING) { "제안은 SOLVING 에서만 가능합니다(현재 $status)." }
        return copy(status = ReplanStatus.DRAFT, draft = draft)
    }

    /** 해가 없다 — 조건을 완화해야 한다. 오류(FAILED)와 구분해야 사용자가 할 일을 안다. */
    fun noSolution(at: Instant): ReplanSession {
        require(status == ReplanStatus.SOLVING) { "해 없음은 SOLVING 에서만 가능합니다(현재 $status)." }
        return copy(status = ReplanStatus.NO_SOLUTION, closedAt = at)
    }

    /** 산출 자체가 실패했다 — 재시도하면 달라질 수 있다. */
    fun failed(at: Instant): ReplanSession {
        require(isOpen) { "실패 표시는 열린 세션에만 가능합니다(현재 $status)." }
        return copy(status = ReplanStatus.FAILED, closedAt = at)
    }

    /** 확정 — 여기서 비로소 원 일정에 반영된다. */
    fun applied(at: Instant): ReplanSession {
        require(status == ReplanStatus.DRAFT) { "확정은 DRAFT 에서만 가능합니다(현재 $status)." }
        return copy(status = ReplanStatus.APPLIED, closedAt = at)
    }

    /** 취소는 **세션만** 닫는다(INV-U4-05). 열린 상태 어디서나 가능하다 — 산출 중 이탈도 취소다. */
    fun canceled(at: Instant): ReplanSession {
        require(isOpen) { "취소는 열린 세션에만 가능합니다(현재 $status)." }
        return copy(status = ReplanStatus.CANCELED, closedAt = at)
    }
}

/** 재계획 범위(DEC-U4-3). ai `ReplanScope` 어휘를 그대로 쓴다 — 백엔드가 별도 taxonomy 를 만들지 않는다(DEC-U4-4). */
enum class ReplanScope { PARTIAL_SLOTS, FULL_DAY }

enum class ReplanStatus { COLLECTING, SOLVING, DRAFT, APPLIED, CANCELED, FAILED, NO_SOLUTION }

/**
 * 출발 기준점(정본 §5 사다리). GPS 가 없으면 수동 핀 → 마지막 방문지 → 숙소 순으로 내려간다.
 * 어느 단계에서 왔는지 남기는 이유: 화면이 "추정 출발지"임을 밝혀야 하기 때문이다(US-PLANB-10).
 */
data class ReplanOrigin(val kind: OriginKind, val lat: Double?, val lng: Double?) {
    init {
        // GPS·수동은 좌표가 있어야 뜻이 있다. 나머지는 서버가 유도하므로 좌표 없이 올 수 있다.
        require(kind !in COORD_REQUIRED || (lat != null && lng != null)) {
            "$kind 기준점에는 좌표가 필요합니다."
        }
    }

    /** 사용자에게 "추정 출발지"로 밝혀야 하는가 — GPS 가 아니면 전부 추정이다. */
    val isEstimated: Boolean get() = kind != OriginKind.GPS

    private companion object {
        private val COORD_REQUIRED = setOf(OriginKind.GPS, OriginKind.MANUAL)
    }
}

enum class OriginKind { GPS, MANUAL, LAST_VISIT, STAY_ANCHOR }

interface ReplanSessionRepository {
    fun save(session: ReplanSession): ReplanSession

    fun findById(sessionId: UUID): ReplanSession?

    /** 열린 세션(COLLECTING·SOLVING·DRAFT). INV-U4-06 판정 입력. */
    fun findOpenByTrip(tripId: UUID): ReplanSession?
}
