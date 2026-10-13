package com.trippilot.assistant.domain

import java.time.Instant
import java.util.UUID

/**
 * 대화 맥락의 단위(DEC-U8-5). 여행 하나에 ACTIVE 세션 하나, 여행 없는 일반 세션도 계정당 하나다(INV-U8-01) —
 * 그 보장은 DB 부분 유니크가 한다. 여기 타입은 그 행의 모양일 뿐이다.
 *
 * `dialogue_context`·`refusal_streak` 은 턴 처리가 쓰는 칸이라 이 타입에 아직 없다(TRIP-1378).
 */
data class AssistantSession(
    val sessionId: UUID,
    val accountId: UUID,
    /** null = 일반(무컨텍스트) 세션(BR-U8-05). */
    val tripId: UUID?,
    val createdAt: Instant,
    /** 목록 정렬 기준. 턴이 없던 세션은 만든 시각이다. */
    val lastTurnAt: Instant,
    /** 보존 만료(DATA-U8-01) — 지나면 열지 않고 새로 만든다. */
    val expiresAt: Instant,
)

interface AssistantSessionRepository {
    /**
     * 그 (계정, 여행)의 ACTIVE 세션이 없으면 [candidate] 를 넣고, 있으면 **있는 것**을 돌려준다.
     * 판정과 삽입이 한 문장이어야 한다 — 선검사 후 삽입은 앱을 두 번 연 요청이 동시에 통과한다.
     */
    fun openOrGet(candidate: AssistantSession): AssistantSession

    /** 본인의 살아 있는 세션. 보존 기간이 지난 것은 없는 것이다 — 열기·목록이 없다고 하는 대화를 id 로는 읽히게 두지 않는다. */
    fun findOwned(accountId: UUID, sessionId: UUID, now: Instant): AssistantSession?

    /** 최근 대화순. 만료된 세션은 빼고 준다. */
    fun findByAccount(accountId: UUID, now: Instant, limit: Int): List<AssistantSession>

    /** 세션과 그 메시지·제안을 지운다(hard delete, DATA-U8-05). 지운 행 수 — 남의 세션이면 0 이다. */
    fun delete(accountId: UUID, sessionId: UUID): Int

    /** 그 여행의 대화를 전부 지운다 — 여행이 지워졌을 때(FD §2.2). 지운 행 수. */
    fun deleteByTrip(tripId: UUID): Int
}
