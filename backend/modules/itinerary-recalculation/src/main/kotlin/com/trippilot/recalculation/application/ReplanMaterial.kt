package com.trippilot.recalculation.application

import java.util.UUID

/**
 * 선계산 재료(situation-awareness BR-SA-18 ④ · CD10) — 알림 사건의 그 날 위험(`dateRisks`) → 재계획 세션 입력. 순수 함수다.
 *
 * **매핑의 주인은 C10 이다.** 사건은 사실(kind·변형·영향 POI·영향 범위)만 싣는다 — 사유·지시 키는 재계획 어휘라 감지(C9)가
 * 알 이유가 없다. 키는 문자열이라 컴파일러가 못 본다 — 철자는 `ReplanMaterialTest` 가 FE 사유 카탈로그·AI 지시 사전과 대조한다.
 *
 * | 변형 | 사유 | 지시 | 제외 POI |
 * |---|---|---|---|
 * | RAIN·SNOW(·변형 모름) | WEATHER | — (AI 가 INDOOR·LESS_MOVE 를 암시) | 영향 범위 SOME 이면 영향 POI |
 * | WIND·HEAT·COLD·DUST | WEATHER | AVOID_OUTDOOR(같은 축 암시 INDOOR 를 대신하고 LESS_MOVE 는 남는다) | 〃 |
 * | CLOSURE 변형 전부 | TEMP_CLOSED | — | 그 POI |
 * | CLOUD | 주의 — 선계산 없음 | | |
 *
 * 자유 텍스트는 쓰지 않는다 — 번역 LLM·사용자 발화 해석을 부른다. DELAY·MANUAL 은 재료가 아니다(U10 소관 — 매핑이 없다).
 */
object ReplanMaterial {

    /** FE 사유 카탈로그 키(`replanChoices.ts` REPLAN_REASONS) — C8 경계가 AI 어휘(`weather`·`closed`)로 번역한다. */
    const val REASON_WEATHER = "WEATHER"
    const val REASON_CLOSED = "TEMP_CLOSED"

    /** AI 지시 사전 키(`ai/data/replan_directives.yaml`) — 번역 없이 그대로 나간다. */
    const val DIRECTIVE_AVOID_OUTDOOR = "AVOID_OUTDOOR"

    /** 세션 입력 각 목록의 상한 — 사용자 진입 요청의 상한(10)과 같다. */
    private const val MAX_ITEMS = 10

    private const val KIND_WEATHER = "WEATHER"
    private const val KIND_CLOSURE = "CLOSURE"

    /** 주의 변형 — 선계산하지 않는다(흐려도 도시 야경은 보인다, O-SA-4). */
    private const val VARIANT_CLOUD = "CLOUD"

    /** 실외에 머무는 것 자체가 위험한 날씨 — 실내 선호(암시 INDOOR)가 아니라 실외 회피를 건다. */
    private val OUTDOOR_HAZARDS = setOf("WIND", "HEAT", "COLD", "DUST")

    /** 영향 범위가 일부일 때만 영향 POI 를 뺀다 — 대부분이면 하루 방향 전환(사유·지시)이 일을 한다(G-SA-11). */
    private const val COVERAGE_SOME = "SOME"

    /** 사건의 그 날 위험 한 건(`PlanBTriggered.dateRisks[]`). [coverage] 는 날씨만 — 모르면 null. */
    data class Risk(val kind: String, val variant: String?, val poiIds: List<UUID>, val coverage: String?)

    data class Material(val reasons: List<String>, val directives: List<String>, val excludedPoiIds: List<UUID>)

    /** 재료가 없으면(흐림뿐·지연뿐) null — 선계산 대상이 아니다. */
    fun of(risks: List<Risk>): Material? {
        val reasons = LinkedHashSet<String>()
        val directives = LinkedHashSet<String>()
        val excluded = LinkedHashSet<UUID>()
        for (risk in risks) {
            when (risk.kind) {
                KIND_WEATHER -> {
                    if (risk.variant == VARIANT_CLOUD) continue
                    reasons += REASON_WEATHER
                    if (risk.variant in OUTDOOR_HAZARDS) directives += DIRECTIVE_AVOID_OUTDOOR
                    if (risk.coverage == COVERAGE_SOME) excluded += risk.poiIds
                }
                KIND_CLOSURE -> {
                    reasons += REASON_CLOSED
                    excluded += risk.poiIds
                }
            }
        }
        if (reasons.isEmpty()) return null
        return Material(reasons.take(MAX_ITEMS), directives.take(MAX_ITEMS), excluded.take(MAX_ITEMS))
    }
}
