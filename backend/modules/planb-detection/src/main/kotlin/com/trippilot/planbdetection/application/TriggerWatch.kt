package com.trippilot.planbdetection.application

import java.time.Instant

/**
 * 지금 감시가 도는 스윕 출처 — GET /triggers 의 회수 필터와 감시 상태 '꺼짐'의 판정 입력(규칙 14).
 *
 * 스윕(PR-A2)이 설정(mode·sources·observe-only)과 감지기 live 로 이 빈을 낸다.
 * **빈이 없으면 아무 출처도 감시하지 않는다** — 스윕을 끈 것과 같다: 스윕 출처 트리거는 즉시 숨고 감시 상태는 OFF.
 * 그래서 스윕을 끄는 것이 곧 회수다(일괄 만료 명령을 두지 않는다 — 검토 O22).
 */
fun interface WatchingSources {
    /** mode=on ∧ 그 출처가 sources 에 있고 관찰 전용이 아니며 live 인가. */
    fun isWatching(source: String): Boolean
}

/** 감시 상태 — 출처 묶음별(날씨 = kma-forecast, 휴무 = place, 지연). */
data class TriggerWatch(val weather: WatchView, val closure: WatchView, val delay: WatchView)

/** [checkedAt] = 마지막으로 확인한 시각 — 확인한 적이 없거나 마지막 관측이 모름이면 null. */
data class WatchView(val status: Status, val checkedAt: Instant?) {
    enum class Status { CHECKED, UNKNOWN, OFF }
}
