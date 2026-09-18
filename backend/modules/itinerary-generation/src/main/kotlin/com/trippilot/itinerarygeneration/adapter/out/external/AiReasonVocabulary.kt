package com.trippilot.itinerarygeneration.adapter.out.external

import org.slf4j.LoggerFactory

/**
 * FE 재계획 사유 어휘 → AI 경계 어휘(연동 설계 `ai-backend-replan-연동-설계.md` §3 번역표).
 *
 * **번역 지점은 여기 한 곳이다.** 흩어지면 FE·AI 어느 한쪽이 어휘를 늘릴 때 고칠 자리가 여럿이 되고,
 * 같은 사유인데 경로마다 다른 값이 나가 상대 분기가 갈린다. 재계획(`replan`)과 슬롯 후보
 * (`alternatives`)가 같은 표를 본다.
 *
 * **상대 `reason` 은 계약상 enum 이 아니다**(`{"default":"none","type":"string"}`). 오타를 422 로
 * 잡아 주지 않고 KB 검색 질의만 조용히 오염된다 — 그래서 미지 어휘를 그대로 흘리지 않고 여기서
 * [NONE] 으로 눕히되, 침묵하지 않고 WARN 을 남긴다(INV-4).
 *
 * `directives` 는 **번역하지 않는다**(설계 §3) — FE 키를 그대로 보내고 상대 사전이 그 키를 안다.
 * 사전은 FE 칩(7종)보다 넓어(20~30종) 번역표를 두면 오히려 좁히는 셈이 된다.
 */
internal object AiReasonVocabulary {

    /** 사유 없음. FE `JUST_CHANGE`("그냥 바꾸고 싶어요")와 미지 어휘가 함께 눕는 자리다. */
    const val NONE = "none"

    /**
     * 설계 §3 표 그대로. `FULLY_BOOKED`(예약 마감)는 `canceled`(예약 취소)와 **다른 사유**라
     * 상대가 별도 값을 열었다 — 한 항목으로 묶으면 "마감이라 못 간다"가 "취소했다"로 읽힌다.
     */
    private val FE_TO_AI: Map<String, String> = mapOf(
        "WEATHER" to "weather",
        "TEMP_CLOSED" to "closed",
        "SLOW_MOVE" to "delay",
        "LOW_ENERGY" to "fatigue",
        "FULLY_BOOKED" to "fully_booked",
        "JUST_CHANGE" to NONE,
    )

    /** 와이어에 실릴 수 있는 값의 전부 — 여기 없는 문자열이 나가면 KB 질의가 오염된다. */
    val AI_VOCABULARY: Set<String> = FE_TO_AI.values.toSet()

    private val log = LoggerFactory.getLogger(AiReasonVocabulary::class.java)

    /**
     * FE 사유 코드 → 상대 어휘. null(사유 없는 흐름 — h12/h18 일정 편집)과 미지 어휘는 [NONE].
     *
     * 미지 어휘를 400 으로 막지 않는 이유: 사유는 **후보 랭킹을 거드는 힌트**지 요청의 성립 조건이
     * 아니다. FE 카탈로그가 늘었는데 서버 배포가 늦었다고 교체 기능 자체가 멈추면 손해가 더 크다.
     */
    fun toAi(feKey: String?): String {
        if (feKey == null) return NONE
        return FE_TO_AI[feKey] ?: NONE.also {
            log.warn("모르는 재계획 사유 '{}' — '{}' 로 보냅니다(FE 카탈로그와 어긋났는지 확인).", feKey, it)
        }
    }
}
