package com.trippilot.itinerarygeneration.application

import com.trippilot.changelog.api.AppendChangeLog
import com.trippilot.changelog.api.ChangeLogFacade

/** 변경 이력 대역 — 확정 시 무엇이 append 됐는지 본다(BR-U4-30). */
internal class CapturingChangeLogs : ChangeLogFacade {
    val appended = mutableListOf<AppendChangeLog>()

    /** 기록 실패가 변경을 함께 되돌리는지(같은 트랜잭션) 보려고 터뜨릴 때 쓴다. */
    var failWith: RuntimeException? = null

    override fun append(command: AppendChangeLog) {
        failWith?.let { throw it }
        appended += command
    }
}

/** 재계획 확정 테스트의 기본 사유 — C10 이 조립해 넘기는 자리다. */
internal const val REASON = "자동 감지 · 비 예보 · 실내로"
