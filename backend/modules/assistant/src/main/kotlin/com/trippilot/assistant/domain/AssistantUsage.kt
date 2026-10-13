package com.trippilot.assistant.domain

import java.time.LocalDate
import java.util.UUID

/**
 * 계정·일 사용량(COST-U8-01). **대화 기록과 따로 센다** — 이력을 지워도 줄지 않아야 지우기가 상한 우회 수단이 되지 않는다.
 */
interface AssistantUsageRepository {
    /** 그 날의 LLM 턴 수. 행이 없으면 0. */
    fun llmTurns(accountId: UUID, day: LocalDate): Int

    /**
     * 턴 하나를 센다. [llm] 이면 LLM 턴으로도 센다(COST-U8-02).
     * [turn] 이 false 면 턴 수는 그대로 두고 LLM 턴만 센다 — 겹쳐 처리된 같은 턴이 LLM 을 한 번 더 쓴 경우다.
     */
    fun record(accountId: UUID, day: LocalDate, llm: Boolean, turn: Boolean = true)
}

/** 계정 단위 직렬화(SEC-U8-01) — 걸린 트랜잭션이 끝날 때 풀린다. 파드가 여럿이어도 분당 제한이 정확하게. */
fun interface AccountTurnLock {
    fun acquire(accountId: UUID)
}
